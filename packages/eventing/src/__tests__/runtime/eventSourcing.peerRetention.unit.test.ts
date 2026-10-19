/**
 * @vitest-environment node
 * A host pipeline's retention covers the peer lanes it hosts, live and on replay (ARCHITECTURE §9).
 * Spec: packages/eventing/specs/peer-projection.feature
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineAggregate } from "../../domain/definitions.ts";
import { createTenantId } from "../../domain/tenantId.ts";
import { EventSourcing } from "../../eventSourcing.ts";
import { sealPipelineDefinition } from "../../pipeline/sealedPipeline.ts";
import { definePipeline } from "../../pipeline/staticBuilder.ts";
import type { PeerEvent } from "../../projections/peerProjection.ts";
import type { ProjectionStoreContext } from "../../projections/projectionStoreContext.ts";
import { FoldAccumulator, MapAccumulator } from "../../replay/replayExecutor.ts";
import { replayProjectionsOf } from "../../replay/replayProjections.ts";
import type { RetentionPolicy, RetentionPolicyResolver } from "../../runtime.types.ts";
import { testEventSchema } from "../../services/__tests__/testHelpers.ts";
import { EventStoreMemory } from "../../stores/eventStoreMemory.ts";

interface Totals {
  costs: number[];
  LastEventOccurredAt: number;
}

const SPAN_RECEIVED = "lw.owner.span_received";
const spanData = z.object({ cost: z.number() });
const spanSchema = testEventSchema(SPAN_RECEIVED, spanData);
const peerSpan = [{ type: SPAN_RECEIVED, data: spanData }] as const;
const tenant = "project-long";
const policy: RetentionPolicy = { traces: 365, scenarios: 30, experiments: 30 };

/** Every policy the peer fold's and the peer map's stores were handed, by lane. */
function stampedStores() {
  const stamped = { fold: [] as (RetentionPolicy | null)[], map: [] as (RetentionPolicy | null)[] };
  const stamp = (
    lane: keyof typeof stamped,
    context: { retentionPolicy?: RetentionPolicy | null },
  ): void => {
    stamped[lane].push(context.retentionPolicy ?? null);
  };
  return {
    stamped,
    fold: {
      store: async (_state: Totals, context: ProjectionStoreContext) => stamp("fold", context),
      storeBatch: async (entries: { context: ProjectionStoreContext }[]) => {
        for (const { context } of entries) stamp("fold", context);
      },
      get: async () => ({ kind: "empty" as const }),
      getWithApplied: async () => ({ state: null, appliedEventIds: [], miss: "absent" as const }),
    },
    map: {
      append: async (_record: { cost: number }, context: ProjectionStoreContext) =>
        stamp("map", context),
    },
  };
}

function ownerPipeline() {
  return definePipeline({ name: "owner_spans", aggregate: defineAggregate({ type: "owner" }) })
    .withEvents([spanSchema])
    .build();
}

function hostPipeline({
  stores,
  retention,
}: {
  stores: ReturnType<typeof stampedStores>;
  retention?: RetentionPolicyResolver;
}) {
  const builder = definePipeline({ name: "host", aggregate: defineAggregate({ type: "global" }) })
    .withEvents([])
    .withPeerFoldProjection({
      events: peerSpan,
      fold: {
        name: "costTotals",
        version: "2026-10-08",
        eventTypes: [SPAN_RECEIVED],
        init: (): Totals => ({ costs: [], LastEventOccurredAt: 0 }),
        apply: (state, event: PeerEvent<typeof peerSpan>) => ({
          costs: [...state.costs, event.data.cost],
          LastEventOccurredAt: Math.max(state.LastEventOccurredAt, event.occurredAt),
        }),
        store: stores.fold,
        LastEventOccurredAtKey: "LastEventOccurredAt",
      },
    })
    .withPeerMapProjection({
      events: peerSpan,
      map: {
        name: "spanLedger",
        eventTypes: [SPAN_RECEIVED],
        map: (event) => ({ cost: event.data.cost }),
        store: stores.map,
      },
    });
  return (retention ? builder.withRetention(retention) : builder).build();
}

function span(id: string) {
  return {
    id,
    aggregateId: "trace-a",
    aggregateType: "owner",
    tenantId: createTenantId(tenant),
    type: SPAN_RECEIVED,
    version: "2026-10-08",
    createdAt: 10,
    occurredAt: 10,
    data: { cost: 1 },
  } satisfies z.infer<typeof spanSchema>;
}

async function deliverLive({
  host,
  runtimeRetention,
}: {
  host: ReturnType<typeof hostPipeline>;
  runtimeRetention?: RetentionPolicyResolver;
}) {
  const eventSourcing = EventSourcing.createWithStores({
    eventStore: EventStoreMemory.createForTesting(),
    ...(runtimeRetention ? { retentionPolicyResolver: runtimeRetention } : {}),
  });
  eventSourcing.register(host);
  const owner = eventSourcing.register(ownerPipeline());
  await owner.service.storeEvents([span("e1")], { tenantId: createTenantId(tenant) });
  return eventSourcing;
}

describe("a peer projection's retention", () => {
  describe("given a host pipeline declaring its tenants' retention", () => {
    /** @scenario "A peer projection's rows take its host pipeline's retention" */
    it("stamps the peer fold's and the peer map's rows with the host's answer", async () => {
      const stores = stampedStores();
      const resolve = vi.fn(async (tenantId: string) => (tenantId === tenant ? policy : null));
      const eventSourcing = await deliverLive({
        host: hostPipeline({ stores, retention: { resolve } }),
      });

      await vi.waitFor(() => {
        expect(stores.stamped.fold).toEqual([policy]);
        expect(stores.stamped.map).toEqual([policy]);
      });
      expect(resolve).toHaveBeenCalledWith(tenant);
      await eventSourcing.close();
    });

    /** @scenario "A projection replay stamps a peer projection's rows with the tenant's retention" */
    it("rebuilds both lanes on replay with the policy live delivery stamped", async () => {
      const stores = stampedStores();
      const retention: RetentionPolicyResolver = { resolve: async () => policy };
      const definitions = [
        sealPipelineDefinition(ownerPipeline()),
        sealPipelineDefinition(hostPipeline({ stores, retention })),
      ];
      const { projections, mapProjections } = replayProjectionsOf(definitions);
      const fold = projections.find(({ projectionName }) => projectionName === "host.costTotals");
      const map = mapProjections.find(({ projectionName }) => projectionName === "host.spanLedger");
      const accumulators = [
        fold?.open(
          (definition) => new FoldAccumulator(definition, { retentionResolver: retention }),
        ),
        map?.open((definition) => new MapAccumulator(definition, { retentionResolver: retention })),
      ];

      for (const accumulator of accumulators) {
        accumulator?.apply({ ...span("e1"), timestamp: 10, idempotencyKey: "e1" });
        await accumulator?.flush();
      }

      expect(stores.stamped).toEqual({ fold: [policy], map: [policy] });
    });
  });

  describe("given a host pipeline declaring no retention", () => {
    /** @scenario "A peer projection whose host declares no retention keeps the store's default" */
    it("hands the peer lanes' stores no policy and never asks the runtime's resolver", async () => {
      const stores = stampedStores();
      const runtimeRetention = { resolve: vi.fn(async () => policy) };
      const eventSourcing = await deliverLive({ host: hostPipeline({ stores }), runtimeRetention });

      await vi.waitFor(() => {
        expect(stores.stamped.fold).toEqual([null]);
        expect(stores.stamped.map).toEqual([null]);
      });
      expect(runtimeRetention.resolve).not.toHaveBeenCalled();
      await eventSourcing.close();
    });
  });
});
