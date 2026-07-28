/**
 * @vitest-environment node
 *
 * Proves OTel carrier continuity through the SUBSCRIBER → process-service
 * path with a REAL TracerProvider: the ambient trace active while the
 * subscriber handles a queued event is captured onto the persisted intent,
 * and dispatching through the typed Langy intent
 * handlers — in a fresh context — continues that same trace.
 */
import { context, propagation, SpanKind, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  InMemoryProcessStore,
  ProcessManagerService,
  type ProcessRef,
} from "~/server/event-sourcing/process-manager";
import { OutboxDispatcherService } from "~/server/event-sourcing/process-manager";
import type { EventSubscriberContext } from "~/server/event-sourcing/subscribers/eventSubscriber.types";

import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import {
  buildIntentHandlers,
  ProcessRuntime,
} from "~/server/event-sourcing/process-manager/processRuntime";

import type { LangyConversationProcessingEvent } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/events";
import { langyConversationProcess } from "../langyConversationProcess";
import { createStubLangyEffectPorts } from "../langyEffectPorts";
import {
  LANGY_CONVERSATION_PROCESS_NAME,
  type LangyConversationProcessState,
} from "../langyConversationProcess.types";
import {
  agentTurnAcceptedEvent,
  CONVERSATION_ID,
  PROJECT_ID,
  T0,
} from "./helpers/langyEventFixtures";

/**
 * The EXACT definition the runtime mounts — built through the pipeline's own
 * `langyConversationProcess` applier and the runtime's
 * `buildProcessDefinition`, so these tests cover the generated evolve
 * (intent-key prefixing, undeclared-event guard, schema-validated intent
 * payloads) rather than a re-implementation. The effect ports are stubs:
 * evolve never dispatches.
 */
function buildLangyManager(ports = createStubLangyEffectPorts().ports) {
  return buildProcessManager<LangyConversationProcessingEvent>({
    name: LANGY_CONVERSATION_PROCESS_NAME,
    applier: langyConversationProcess(ports),
  });
}

const W3C_TRACEPARENT_REGEX = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([0-9a-f]{2})$/;

const ref: ProcessRef = {
  processName: LANGY_CONVERSATION_PROCESS_NAME,
  projectId: PROJECT_ID,
  processKey: CONVERSATION_ID,
};

const subscriberContext: EventSubscriberContext = {
  tenantId: PROJECT_ID,
  aggregateId: CONVERSATION_ID,
};

describe("Langy process trace continuity", () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;
  let store: InMemoryProcessStore;

  beforeAll(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  beforeEach(() => {
    store = new InMemoryProcessStore();
  });

  afterEach(() => {
    exporter.reset();
  });

  /**
   * The `pm:langyConversation` subscriber ProcessRuntime generates for the
   * pipeline — the real production path now that Langy no longer hand-rolls
   * one. It builds the envelope (including the content boundary) and drives
   * the process itself.
   */
  function generatedSubscriber(ports = createStubLangyEffectPorts().ports) {
    const runtime = new ProcessRuntime({ store, consumersEnabled: false });
    const definition = buildLangyManager(ports);
    const { subscribers } = runtime.registerPipeline<LangyConversationProcessingEvent>({
      pipelineName: "langy-conversation-processing",
      processManagers: new Map([[LANGY_CONVERSATION_PROCESS_NAME, definition]]),
    });
    const subscriber = subscribers[0];
    if (!subscriber) throw new Error("runtime generated no subscriber");
    return subscriber;
  }

  async function handleStartedTurnInsideProducerSpan(
    subscriber: { handle: (event: any, context: any) => Promise<void> },
  ): Promise<{ producerTraceId: string }> {
    const tracer = trace.getTracer("test");
    return await tracer.startActiveSpan(
      "langy.queue.consume",
      async (producer) => {
        try {
          await subscriber.handle(
            agentTurnAcceptedEvent({
              id: "evt_started",
              occurredAt: T0,
              turnId: "turn_1",
            }),
            subscriberContext,
          );
          return { producerTraceId: producer.spanContext().traceId };
        } finally {
          producer.end();
        }
      },
    );
  }

  describe("given the subscriber handles a queued event inside an active trace", () => {
    it("persists the ambient W3C carrier on the pending intent", async () => {
      const { producerTraceId } = await handleStartedTurnInsideProducerSpan(
        generatedSubscriber(),
      );

      const [message] = await store.findMessagesByRef({ ref });
      expect(message).toBeDefined();
      expect(message!.status).toBe("pending");
      const traceparent = message!.traceCarrier.traceparent;
      expect(traceparent).toMatch(W3C_TRACEPARENT_REGEX);
      const [, carrierTraceId] = W3C_TRACEPARENT_REGEX.exec(traceparent!)!;
      expect(carrierTraceId).toBe(producerTraceId);
    });
  });

  describe("when the outbox later dispatches the intent in a fresh context", () => {
    it("continues the original trace through the typed Langy handler", async () => {
      const { ports, calls } = createStubLangyEffectPorts();
      const { producerTraceId } = await handleStartedTurnInsideProducerSpan(
        generatedSubscriber(ports),
      );
      const [message] = await store.findMessagesByRef({ ref });
      const [, , carrierSpanId] = W3C_TRACEPARENT_REGEX.exec(
        message!.traceCarrier.traceparent!,
      )!;

      const dispatcher = new OutboxDispatcherService({
        store,
        // The builder generates these from the declared intents, schema
        // validation included -- Langy no longer hand-writes them.
        handlers: buildIntentHandlers(buildLangyManager(ports).config),
      });
      // The generated subscriber stamps the commit with real `Date.now()` --
      // unlike the hand-rolled one it replaces, it takes no injectable clock --
      // so the dispatch window has to be read against the same clock.
      const report = await dispatcher.runOnce({ now: Date.now() + 1 });

      expect(report.dispatched).toEqual([`process:${CONVERSATION_ID}:dispatch:turn_1`]);
      expect(calls.dispatchedTurns).toEqual([
        {
          projectId: PROJECT_ID,
          conversationId: CONVERSATION_ID,
          turnId: "turn_1",
          resumeFromTurnId: null,
        },
      ]);

      const consumerSpan = exporter
        .getFinishedSpans()
        .find((span) => span.kind === SpanKind.CONSUMER);
      expect(consumerSpan).toBeDefined();
      expect(consumerSpan!.spanContext().traceId).toBe(producerTraceId);
      expect(consumerSpan!.parentSpanContext?.spanId).toBe(carrierSpanId);
      expect(consumerSpan!.attributes).toMatchObject({
        "process.name": LANGY_CONVERSATION_PROCESS_NAME,
        "process.key": CONVERSATION_ID,
        "process.message_key": `process:${CONVERSATION_ID}:dispatch:turn_1`,
        "process.attempt": 1,
        "tenant.id": PROJECT_ID,
        "project.id": PROJECT_ID,
      });
    });
  });
});
