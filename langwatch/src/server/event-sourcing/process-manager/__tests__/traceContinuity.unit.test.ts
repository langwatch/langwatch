/**
 * @vitest-environment node
 *
 * Proves the OTel correctness requirements of the process-manager core with a
 * REAL TracerProvider (no logging assertions):
 *
 * - committing an intent captures the full active W3C carrier
 *   (traceparent + baggage) onto the persisted outbox message via
 *   propagation.inject; and
 * - dispatching later, in a fresh context, restores that carrier via
 *   propagation.extract so the consumer span continues the original trace as
 *   a child of the persisted span context — including across retries.
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
  vi,
} from "vitest";

import { OutboxDispatcherService } from "../outbox/outboxDispatcherService";
import { ProcessManagerService } from "../processManagerService";
import { InMemoryProcessStore } from "../stores/inMemoryProcessStore";
import {
  type PilotState,
  pilotDefinition,
  pilotEvent,
  pilotRef,
  T0,
} from "./helpers/pilotProcess.fixture";

const W3C_TRACEPARENT_REGEX =
  /^00-([a-f0-9]{32})-([a-f0-9]{16})-([0-9a-f]{2})$/;

describe("process-manager trace continuity", () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;
  let store: InMemoryProcessStore;
  let service: ProcessManagerService<PilotState>;

  beforeAll(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    // Registers the global tracer provider, the AsyncLocalStorage context
    // manager, and the composite W3C trace-context + baggage propagator.
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
    service = new ProcessManagerService({
      definition: pilotDefinition,
      store,
    });
  });

  afterEach(() => {
    exporter.reset();
  });

  async function handleStartedTurnInsideProducerSpan(): Promise<{
    producerTraceId: string;
  }> {
    const tracer = trace.getTracer("test");
    return await tracer.startActiveSpan("command-handler", async (producer) => {
      try {
        const baggage = propagation.createBaggage({
          "langwatch.tenant": { value: "tenant_1" },
        });
        await context.with(
          propagation.setBaggage(context.active(), baggage),
          async () => {
            await service.handleEvent({
              envelope: pilotEvent({ eventId: "evt_start" }),
              now: T0,
            });
          },
        );
        return { producerTraceId: producer.spanContext().traceId };
      } finally {
        producer.end();
      }
    });
  }

  describe("given an intent commits inside an active traced request", () => {
    it("persists the full W3C carrier on the outbox message", async () => {
      const { producerTraceId } = await handleStartedTurnInsideProducerSpan();

      const [message] = await store.findMessagesByRef({ ref: pilotRef });
      expect(message).toBeDefined();
      const traceparent = message!.traceCarrier.traceparent;
      expect(traceparent).toMatch(W3C_TRACEPARENT_REGEX);
      const [, carrierTraceId] = W3C_TRACEPARENT_REGEX.exec(traceparent!)!;
      expect(carrierTraceId).toBe(producerTraceId);
      expect(message!.traceCarrier.baggage).toContain(
        "langwatch.tenant=tenant_1",
      );
    });

    it("emits an internal evolve span carrying process identity attributes", async () => {
      await handleStartedTurnInsideProducerSpan();

      const evolveSpan = exporter
        .getFinishedSpans()
        .find((span) => span.name === "process langyConversation evolve");
      expect(evolveSpan).toBeDefined();
      expect(evolveSpan!.kind).toBe(SpanKind.INTERNAL);
      expect(evolveSpan!.attributes).toMatchObject({
        "process.name": "langyConversation",
        "process.key": "conv_1",
        "process.source_event_id": "evt_start",
        "tenant.id": "tenant_1",
        "project.id": "proj_1",
        "user.id": "user_1",
      });
    });
  });

  describe("when process evolution fails", () => {
    it("exports a generic exception without customer content or credentials", async () => {
      const sensitiveFailure =
        "Authorization: Bearer sk-live-secret prompt-derived customer text";
      const failingService = new ProcessManagerService({
        definition: {
          ...pilotDefinition,
          name: "failingProcess",
          evolve: () => {
            throw new Error(sensitiveFailure);
          },
        },
        store,
      });

      await expect(
        failingService.handleEvent({
          envelope: pilotEvent({ eventId: "evt_sensitive_failure" }),
          now: T0,
        }),
      ).rejects.toThrow();

      const evolveSpan = exporter
        .getFinishedSpans()
        .find((span) => span.name === "process failingProcess evolve");
      const exceptionEvent = evolveSpan?.events.find(
        (event) => event.name === "exception",
      );
      expect(exceptionEvent?.attributes).toMatchObject({
        "exception.type": "Error",
        "exception.message": "Operation failed; sensitive details were omitted",
      });
      expect(JSON.stringify(exceptionEvent)).not.toContain(sensitiveFailure);
      expect(JSON.stringify(exceptionEvent)).not.toContain("sk-live-secret");
      expect(JSON.stringify(exceptionEvent)).not.toContain("customer text");
    });
  });

  describe("when the outbox dispatches the persisted intent in a fresh context", () => {
    it("continues the original trace as a consumer span parented on the persisted carrier", async () => {
      const { producerTraceId } = await handleStartedTurnInsideProducerSpan();
      const [message] = await store.findMessagesByRef({ ref: pilotRef });
      const [, , carrierSpanId] = W3C_TRACEPARENT_REGEX.exec(
        message!.traceCarrier.traceparent!,
      )!;

      const dispatcher = new OutboxDispatcherService({
        store,
        handlers: { "worker-dispatch": vi.fn().mockResolvedValue(undefined) },
      });
      // No active span here — continuity must come from propagation.extract.
      const report = await dispatcher.runOnce({ now: T0 + 1 });
      expect(report.dispatched).toEqual(["dispatch:turn_1:1"]);

      const consumerSpan = exporter
        .getFinishedSpans()
        .find((span) => span.kind === SpanKind.CONSUMER);
      expect(consumerSpan).toBeDefined();
      expect(consumerSpan!.name).toBe(
        "process langyConversation dispatch worker-dispatch",
      );
      expect(consumerSpan!.spanContext().traceId).toBe(producerTraceId);
      expect(consumerSpan!.parentSpanContext?.spanId).toBe(carrierSpanId);
      expect(consumerSpan!.attributes).toMatchObject({
        "process.name": "langyConversation",
        "process.key": "conv_1",
        "process.source_event_id": "evt_start",
        "process.message_key": "dispatch:turn_1:1",
        "process.intent_type": "worker-dispatch",
        "process.attempt": 1,
        "tenant.id": "tenant_1",
        "project.id": "proj_1",
        "user.id": "user_1",
      });
    });

    it("records every retry attempt as a consumer span in the same trace", async () => {
      const { producerTraceId } = await handleStartedTurnInsideProducerSpan();

      const sensitiveFailure =
        "Authorization: Bearer sk-live-secret prompt-derived customer text";
      const handler = vi
        .fn()
        .mockRejectedValueOnce(new Error(sensitiveFailure))
        .mockResolvedValue(undefined);
      const dispatcher = new OutboxDispatcherService({
        store,
        handlers: { "worker-dispatch": handler },
        retryDelayMs: () => 1_000,
      });

      await dispatcher.runOnce({ now: T0 + 1 });
      await dispatcher.runOnce({ now: T0 + 2_000 });

      const consumerSpans = exporter
        .getFinishedSpans()
        .filter((span) => span.kind === SpanKind.CONSUMER);
      expect(consumerSpans).toHaveLength(2);
      for (const span of consumerSpans) {
        expect(span.spanContext().traceId).toBe(producerTraceId);
      }
      expect(
        consumerSpans.map((span) => span.attributes["process.attempt"]),
      ).toEqual([1, 2]);
      // The failed attempt carries the exception on its span.
      expect(
        consumerSpans[0]!.events.some((event) => event.name === "exception"),
      ).toBe(true);
      const exceptionEvent = consumerSpans[0]!.events.find(
        (event) => event.name === "exception",
      );
      expect(exceptionEvent?.attributes).toMatchObject({
        "exception.type": "Error",
        "exception.message": "Operation failed; sensitive details were omitted",
      });
      expect(JSON.stringify(exceptionEvent)).not.toContain(sensitiveFailure);
      expect(JSON.stringify(exceptionEvent)).not.toContain("sk-live-secret");
      expect(JSON.stringify(exceptionEvent)).not.toContain("customer text");
    });
  });
});
