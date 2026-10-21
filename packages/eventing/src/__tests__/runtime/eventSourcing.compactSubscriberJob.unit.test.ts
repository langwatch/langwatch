/**
 * @vitest-environment node
 * Spec: packages/eventing/specs/compact-subscriber-job.feature
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineAggregate } from "../../domain/definitions.ts";
import { createTenantId } from "../../domain/tenantId.ts";
import type { Event } from "../../domain/types.ts";
import { EventSourcing } from "../../eventSourcing.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import type { FoldProjectionDefinition } from "../../projections/foldProjection.types.ts";
import { EventSourcedQueueProcessorMemory } from "../../queues/memory.ts";
import { testEventSchema } from "../../services/__tests__/testHelpers.ts";
import { EventStoreMemory } from "../../stores/eventStoreMemory.ts";

const STARTED = "lw.run.started";
const startedSchema = testEventSchema(STARTED, z.object({ note: z.string() }));
type Started = z.infer<typeof startedSchema>;
const tenantId = createTenantId("project-1");
const jobSchema = z.object({ runId: z.string(), count: z.number() });

const counter: FoldProjectionDefinition<{ count: number }, Started> & { name: "counter" } = {
  name: "counter",
  version: "1",
  LastEventOccurredAtKey: "lastEventOccurredAt",
  eventTypes: [STARTED],
  init: () => ({ count: 0 }),
  apply: (state) => ({ count: state.count + 1 }),
  store: { store: async () => {}, get: async () => ({ kind: "empty" }) },
};

function runtime({ stageOnSend, compact }: { stageOnSend: boolean; compact: boolean }) {
  const handled = vi.fn(async (_job: z.infer<typeof jobSchema>) => undefined);
  const handledFull = vi.fn(async (_event: Event) => undefined);
  const eventSourcing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    queueFactory: (definition) => new EventSourcedQueueProcessorMemory(definition),
  });
  const base = definePipeline({ name: "run", aggregate: defineAggregate({ type: "run" }) })
    .withEvents([startedSchema])
    .withClickHouseFoldProjection(counter);
  const pipeline = compact
    ? base.withProjectionSubscriber("onStarted", {
        fold: "counter",
        delay: 0,
        dedup: { makeId: (event: Started) => `${event.aggregateId}`, ttlMs: 60_000 },
        job: {
          schema: jobSchema,
          stage: (event, context) => ({ runId: event.aggregateId, count: context.state.count }),
          stageOnSend,
          handler: handled,
        },
      })
    : base.withProjectionSubscriber("onStarted", { fold: "counter", handler: handledFull });
  const registered = eventSourcing.register(pipeline.build());
  const sent = vi.spyOn(eventSourcing.globalQueue!, "send");
  eventSourcing.startConsumers();
  return { eventSourcing, registered, handled, handledFull, sent };
}

const started: Started = {
  id: "e1",
  aggregateId: "run-a",
  aggregateType: "run",
  tenantId,
  type: STARTED,
  version: "2026-10-20",
  createdAt: 10,
  occurredAt: 10,
  data: { note: "span content that must not be queued" },
};

function reactorEnvelopes(sent: ReturnType<typeof runtime>["sent"]) {
  return sent.mock.calls
    .map(([envelope]) => envelope)
    .filter((envelope) => envelope.__jobType === "reactor");
}

describe("a fold subscriber's compact job", () => {
  describe("given the switch to queue compact bodies is off", () => {
    /** @scenario "A full job still queued is staged into its compact body when it runs" */
    it("queues the full delivery and hands the handler the compact body", async () => {
      const { eventSourcing, registered, handled, sent } = runtime({
        stageOnSend: false,
        compact: true,
      });

      await registered.service.storeEvents([started], { tenantId });

      await vi.waitFor(() =>
        expect(handled).toHaveBeenCalledWith(
          { runId: "run-a", count: 1 },
          {
            tenantId: "project-1",
            aggregateId: "run-a",
          },
        ),
      );
      const [envelope] = reactorEnvelopes(sent);
      expect(envelope).toHaveProperty("foldState");
      expect(JSON.stringify(envelope)).toContain("span content");
      await eventSourcing.close();
    });
  });

  describe("given the switch to queue compact bodies is on", () => {
    /** @scenario "With the switch on, the queued job holds only the event's identity and the compact body" */
    it("queues only identifiers, deduplicated as the full delivery was", async () => {
      const off = runtime({ stageOnSend: false, compact: true });
      const on = runtime({ stageOnSend: true, compact: true });

      await off.registered.service.storeEvents([started], { tenantId });
      await on.registered.service.storeEvents([started], { tenantId });

      await vi.waitFor(() =>
        expect(on.handled).toHaveBeenCalledWith(
          { runId: "run-a", count: 1 },
          {
            tenantId: "project-1",
            aggregateId: "run-a",
          },
        ),
      );
      const [compactEnvelope] = reactorEnvelopes(on.sent);
      const [fullEnvelope] = reactorEnvelopes(off.sent);
      expect(compactEnvelope).not.toHaveProperty("foldState");
      expect(JSON.stringify(compactEnvelope)).not.toContain("span content");
      expect(compactEnvelope?.job).toEqual({ runId: "run-a", count: 1 });
      expect(compactEnvelope?.__routing).toEqual(fullEnvelope?.__routing);
      await off.eventSourcing.close();
      await on.eventSourcing.close();
    });
  });

  describe("given a subscriber without a compact job", () => {
    /** @scenario "A compact body queued for a subscriber that reads none is refused" */
    it("refuses the body by its schema and never runs the handler", async () => {
      const { eventSourcing, handledFull } = runtime({ stageOnSend: false, compact: false });
      const { data: _data, version: _version, ...identity } = started;

      await expect(
        eventSourcing.globalQueue?.send({
          event: identity,
          job: { runId: "run-a", count: 1 },
          __pipelineName: "run",
          __jobType: "reactor",
          __jobName: "onStarted",
        }),
      ).rejects.toThrow(/reads no compact job body/);
      expect(handledFull).not.toHaveBeenCalled();
      await eventSourcing.close();
    });
  });
});
