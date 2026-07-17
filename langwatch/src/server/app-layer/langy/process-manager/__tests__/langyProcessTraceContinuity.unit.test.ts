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

import { langyConversationProcessDefinition } from "../langyConversationProcess.definition";
import {
  LANGY_CONVERSATION_PROCESS_NAME,
  type LangyConversationProcessState,
} from "../langyConversationProcess.types";
import {
  createLangyIntentHandlers,
  createStubLangyEffectPorts,
} from "../langyEffectPorts";
import { createLangyProcessTestSubscriber } from "./helpers/langyProcessTestSubscriber";
import {
  agentTurnAcceptedEvent,
  CONVERSATION_ID,
  PROJECT_ID,
  T0,
} from "./helpers/langyEventFixtures";

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

  function subscriberOver(
    service: ProcessManagerService<LangyConversationProcessState>,
  ) {
    return createLangyProcessTestSubscriber({
      processManager: service,
      clock: () => T0,
    });
  }

  async function handleStartedTurnInsideProducerSpan(
    subscriber: ReturnType<typeof createLangyProcessSubscriber>,
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
      const service = new ProcessManagerService({
        definition: langyConversationProcessDefinition,
        store,
      });
      const { producerTraceId } = await handleStartedTurnInsideProducerSpan(
        subscriberOver(service),
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
      const liveService = new ProcessManagerService({
        definition: langyConversationProcessDefinition,
        store,
      });
      const { producerTraceId } = await handleStartedTurnInsideProducerSpan(
        subscriberOver(liveService),
      );
      const [message] = await store.findMessagesByRef({ ref });
      const [, , carrierSpanId] = W3C_TRACEPARENT_REGEX.exec(
        message!.traceCarrier.traceparent!,
      )!;

      const { ports, calls } = createStubLangyEffectPorts();
      const dispatcher = new OutboxDispatcherService({
        store,
        handlers: createLangyIntentHandlers({ ports }),
      });
      const report = await dispatcher.runOnce({ now: T0 + 1 });

      expect(report.dispatched).toEqual(["dispatch:turn_1"]);
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
        "process.message_key": "dispatch:turn_1",
        "process.attempt": 1,
        "tenant.id": PROJECT_ID,
        "project.id": PROJECT_ID,
      });
    });
  });
});
