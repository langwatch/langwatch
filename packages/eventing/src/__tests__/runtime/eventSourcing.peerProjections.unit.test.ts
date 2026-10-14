/**
 * @vitest-environment node
 * A module folds and maps a peer pipeline's events into its own state (ARCHITECTURE §9).
 * Spec: packages/eventing/specs/peer-projection.feature
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineAggregate } from "../../domain/definitions.ts";
import { createTenantId } from "../../domain/tenantId.ts";
import type { Event } from "../../domain/types.ts";
import { EventSourcing } from "../../eventSourcing.ts";
import { sealPipelineDefinition } from "../../pipeline/sealedPipeline.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import type { FoldProjectionStore } from "../../projections/foldProjection.types.ts";
import type { PeerEvent } from "../../projections/peerProjection.ts";
import type { ProjectionRegistry } from "../../projections/projectionRegistry.ts";
import { replayProjectionsOf } from "../../replay/replayProjections.ts";
import { testEventSchema } from "../../services/__tests__/testHelpers.ts";
import { EventStoreMemory } from "../../stores/eventStoreMemory.ts";

const SPAN_RECEIVED = "lw.owner.span_received";
const spanData = z.object({ cost: z.number(), model: z.string() });
const spanSchema = testEventSchema(SPAN_RECEIVED, spanData);
const peerSpan = [{ type: SPAN_RECEIVED, data: spanData }] as const;
const tenantId = createTenantId("project-1");

interface Totals {
  costs: number[];
  LastEventOccurredAt: number;
}

/** A fold store that keeps each aggregate's state and the ids it already folded. */
function memoryFoldStore() {
  const rows = new Map<string, { state: Totals; applied: readonly string[] }>();
  const store: FoldProjectionStore<Totals> = {
    store: async (state, context) => {
      rows.set(context.aggregateId, { state, applied: context.appliedEventIds ?? [] });
    },
    get: async (aggregateId) => {
      const row = rows.get(aggregateId);
      return row ? { kind: "folded", state: row.state } : { kind: "empty" };
    },
    getWithApplied: async (aggregateId) => {
      const row = rows.get(aggregateId);
      return row
        ? { state: row.state, appliedEventIds: [...row.applied] }
        : { state: null, appliedEventIds: [], miss: "absent" };
    },
  };
  return { store, rows };
}

function ownerPipeline() {
  return definePipeline({ name: "owner_spans", aggregate: defineAggregate({ type: "owner" }) })
    .withEvents([spanSchema])
    .build();
}

function hostPipeline({
  store,
  mapped = async () => void 0,
}: {
  store: FoldProjectionStore<Totals>;
  mapped?: (record: { eventId: string; model: string }) => Promise<void>;
}) {
  return definePipeline({ name: "host", aggregate: defineAggregate({ type: "global" }) })
    .withEvents([])
    .withPeerFoldProjection({
      events: peerSpan,
      fold: {
        name: "costTotals",
        version: "2026-10-07",
        eventTypes: [SPAN_RECEIVED],
        init: () => ({ costs: [], LastEventOccurredAt: 0 }),
        apply: (state, event: PeerEvent<typeof peerSpan>) => ({
          costs: [...state.costs, event.data.cost],
          LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt),
        }),
        store,
        LastEventOccurredAtKey: "LastEventOccurredAt",
      },
    })
    .withPeerMapProjection({
      events: peerSpan,
      map: {
        name: "spanLedger",
        eventTypes: [SPAN_RECEIVED],
        map: (event) => ({ eventId: event.id, model: event.data.model }),
        store: { append: (record) => mapped(record) },
        targetTable: "span_ledger",
        options: { groupKeyFn: (event) => `ledger:${event.id}` },
      },
    })
    .build();
}

function span({
  id,
  aggregateId,
  cost,
  occurredAt,
}: {
  id: string;
  aggregateId: string;
  cost: number;
  occurredAt: number;
}): z.infer<typeof spanSchema> {
  return {
    id,
    aggregateId,
    aggregateType: "owner",
    tenantId,
    type: SPAN_RECEIVED,
    version: "2026-10-07",
    createdAt: occurredAt,
    occurredAt,
    data: { cost, model: "gpt-x" },
  };
}

function runtime(capture?: (registry: ProjectionRegistry<Event>) => void) {
  return EventSourcing.createWithStores({
    eventStore: EventStoreMemory.createForTesting(),
    configureGlobalProjections: capture,
  });
}

describe("a peer fold projection", () => {
  /** @scenario "A peer fold folds the owner's events per source aggregate" */
  it("folds each source aggregate's events into its own state, data parsed by the contract", async () => {
    const { store, rows } = memoryFoldStore();
    const eventSourcing = runtime();
    eventSourcing.register(hostPipeline({ store }));
    const owner = eventSourcing.register(ownerPipeline());

    await owner.service.storeEvents(
      [
        span({ id: "e1", aggregateId: "trace-a", cost: 1, occurredAt: 10 }),
        span({ id: "e2", aggregateId: "trace-b", cost: 5, occurredAt: 11 }),
      ],
      { tenantId },
    );
    await vi.waitFor(() => expect(rows.get("trace-a")?.state.costs).toEqual([1]));
    await owner.service.storeEvents(
      [span({ id: "e3", aggregateId: "trace-a", cost: 2, occurredAt: 12 })],
      { tenantId },
    );

    await vi.waitFor(() => {
      expect(rows.get("trace-a")?.state.costs).toEqual([1, 2]);
      expect(rows.get("trace-b")?.state.costs).toEqual([5]);
    });
    await eventSourcing.close();
  });

  /** @scenario "An out-of-order owner event re-folds from the owner's event log" */
  it("re-folds the source aggregate from the owner's log when an older event arrives late", async () => {
    const { store, rows } = memoryFoldStore();
    const eventSourcing = runtime();
    const owner = eventSourcing.register(ownerPipeline());
    eventSourcing.register(hostPipeline({ store }));

    for (const [id, cost] of [
      ["e1", 1],
      ["e3", 3],
    ] as const) {
      await owner.service.storeEvents(
        [span({ id, aggregateId: "trace-a", cost, occurredAt: cost * 10 })],
        { tenantId },
      );
      await vi.waitFor(() => expect(rows.get("trace-a")?.applied).toContain(id));
    }
    expect(rows.get("trace-a")?.state.costs).toEqual([1, 3]);
    await owner.service.storeEvents(
      [span({ id: "e2", aggregateId: "trace-a", cost: 2, occurredAt: 20 })],
      { tenantId },
    );

    await vi.waitFor(() => expect(rows.get("trace-a")?.state.costs).toEqual([1, 2, 3]));
    await eventSourcing.close();
  });

  /** @scenario "A redelivered owner event folds once" */
  it("drops a redelivered event it already folded", async () => {
    const { store, rows } = memoryFoldStore();
    let registry: ProjectionRegistry<Event> | undefined;
    const eventSourcing = runtime((captured) => (registry = captured));
    const owner = eventSourcing.register(ownerPipeline());
    eventSourcing.register(hostPipeline({ store }));
    const event = span({ id: "e1", aggregateId: "trace-a", cost: 4, occurredAt: 10 });

    await owner.service.storeEvents([event], { tenantId });
    await vi.waitFor(() => expect(rows.get("trace-a")?.state.costs).toEqual([4]));
    await registry?.redeliver({ kind: "fold", lane: "host.costTotals", event });

    await vi.waitFor(() => expect(rows.get("trace-a")?.state.costs).toEqual([4]));
    expect(rows.get("trace-a")?.applied).toEqual(["e1"]);
    await eventSourcing.close();
  });

  /** @scenario "A peer projection over an event no registered pipeline declares is refused" */
  it("refuses to start routing when no registered pipeline declares the owner's event type", async () => {
    const eventSourcing = runtime();
    eventSourcing.register(hostPipeline({ store: memoryFoldStore().store }));

    expect(() => eventSourcing.startConsumers()).toThrow(
      /Peer projection "host\.costTotals" consumes \[lw\.owner\.span_received\]/,
    );
    await eventSourcing.close();
  });

  /** @scenario "A peer projection consuming an event it did not name is refused" */
  it("refuses a fold consuming an owner event it named no contract schema for", () => {
    const declare = () =>
      definePipeline({ name: "host", aggregate: defineAggregate({ type: "global" }) })
        .withEvents([])
        .withPeerFoldProjection({
          events: peerSpan,
          fold: {
            name: "costTotals",
            version: "2026-10-07",
            eventTypes: [SPAN_RECEIVED, "lw.owner.unnamed"],
            init: () => ({ costs: [], LastEventOccurredAt: 0 }),
            apply: (state) => state,
            store: memoryFoldStore().store,
            LastEventOccurredAtKey: "LastEventOccurredAt",
          },
        });

    expect(declare).toThrow(/host\.costTotals.*unnamed: \[lw\.owner\.unnamed\]/);
  });
});

describe("a peer map projection", () => {
  /** @scenario "A peer map maps the owner's events, parsed by the contract" */
  it("maps each owner event, data parsed by the contract, keyed by the host's group key", async () => {
    const mapped = vi.fn(async (_record: { eventId: string; model: string }) => void 0);
    const eventSourcing = runtime();
    const owner = eventSourcing.register(ownerPipeline());
    eventSourcing.register(hostPipeline({ store: memoryFoldStore().store, mapped }));

    await owner.service.storeEvents(
      [span({ id: "e1", aggregateId: "trace-a", cost: 1, occurredAt: 10 })],
      { tenantId },
    );

    await vi.waitFor(() => expect(mapped).toHaveBeenCalledWith({ eventId: "e1", model: "gpt-x" }));
    await eventSourcing.close();
  });
});

describe("a projection replay", () => {
  const definitions = [
    sealPipelineDefinition(ownerPipeline()),
    sealPipelineDefinition(hostPipeline({ store: memoryFoldStore().store })),
  ];

  /** @scenario "A projection replay rebuilds a peer projection from the owner's events" */
  it("lists the peer lanes under the owner's aggregate type, paused on the global pipeline", () => {
    const { projections, mapProjections } = replayProjectionsOf(definitions);
    const fold = projections.find(({ projectionName }) => projectionName === "host.costTotals");
    const map = mapProjections.find(({ projectionName }) => projectionName === "host.spanLedger");

    expect(fold).toMatchObject({
      source: "global",
      pipelineName: "global",
      aggregateType: "owner",
      pauseKey: "global/projection/host.costTotals",
      kind: "fold",
    });
    expect(map).toMatchObject({
      aggregateType: "owner",
      pauseKey: "global/handler/host.spanLedger",
      kind: "map",
      targetTable: "span_ledger",
    });
  });

  /** @scenario "A projection replay rebuilds a peer projection from the owner's events" */
  it("folds the owner's stored events through the contract schema as it does live", () => {
    const fold = replayProjectionsOf(definitions).projections.find(
      ({ projectionName }) => projectionName === "host.costTotals",
    );
    const stream: Event[] = [
      span({ id: "e1", aggregateId: "trace-a", cost: 1, occurredAt: 10 }),
      span({ id: "e2", aggregateId: "trace-a", cost: 2, occurredAt: 20 }),
    ];

    const rebuilt = fold?.open((definition) =>
      stream.reduce((state, event) => definition.apply(state, event), definition.init()),
    );

    expect(rebuilt).toEqual({ costs: [1, 2], LastEventOccurredAt: 20 });
    expect(() =>
      fold?.open((definition) =>
        definition.apply(definition.init(), { ...stream[0]!, data: { cost: "one" } }),
      ),
    ).toThrow(z.ZodError);
  });
});
