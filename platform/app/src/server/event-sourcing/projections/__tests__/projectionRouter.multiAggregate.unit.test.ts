/**
 * specs/event-sourcing/multi-aggregate-pipeline.feature — fold state, re-fold
 * loaders and projection kill-switches on a pipeline that owns several
 * aggregate types (ADR-113). Driven through EventSourcingService with a real
 * in-memory event store and a real in-memory projection repository, so the
 * keys asserted are the ones that would reach a row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureFlagServiceInterface } from "../../../featureFlag/types";
import {
  type AggregateScope,
  declaredAggregateScope,
} from "../../domain/aggregateScope";
import type { AggregateType } from "../../domain/aggregateType";
import type { EventType } from "../../domain/eventType";
import { createTenantId } from "../../domain/tenantId";
import type { Event, Projection } from "../../domain/types";
import {
  createTestEvent,
  createTestTenantId,
  TEST_CONSTANTS,
} from "../../services/__tests__/testHelpers";
import { EventSourcingService } from "../../services/eventSourcingService";
import { BaseMemoryProjectionStore } from "../../stores/baseMemoryProjectionStore";
import { EventStoreMemory } from "../../stores/eventStoreMemory";
import type { FoldProjectionDefinition } from "../foldProjection.types";
import { RepositoryFoldStore } from "../repositoryFoldStore";

const GRANT = "authz_grant" as const satisfies AggregateType;
const ROLE = "authz_role" as const satisfies AggregateType;
const GRANT_ATTACHED = "lw.authz.grant.attached" as EventType;
const ROLE_DEFINED = "lw.authz.role.defined" as EventType;
const SPAN_RECEIVED = "lw.obs.trace.span_received" as EventType;

const authzScope = declaredAggregateScope({
  [GRANT]: [GRANT_ATTACHED],
  [ROLE]: [ROLE_DEFINED],
});

class MemoryProjectionRepository extends BaseMemoryProjectionStore<Projection> {
  protected getKey(tenantId: string, id: string): string {
    return `${tenantId}:${id}`;
  }
  get rowKeys(): string[] {
    return [...this.store.keys()].map((k) => k.split(":").slice(1).join(":"));
  }
  clear(): void {
    this.store.clear();
  }
}

interface LedgerState {
  seen: string[];
  LastEventOccurredAt?: number;
}

type LedgerProjection = Projection<LedgerState>;

function ledgerFold(repo: MemoryProjectionRepository, eventTypes: EventType[]) {
  const fold: FoldProjectionDefinition<LedgerState, Event> = {
    name: "ledger",
    version: "2026-08-22",
    LastEventOccurredAtKey: "LastEventOccurredAt",
    eventTypes,
    init: () => ({ seen: [] }),
    apply: (state, event) => ({
      seen: [...state.seen, event.id],
      LastEventOccurredAt: event.occurredAt,
    }),
    store: new RepositoryFoldStore<LedgerState>(repo, "2026-08-22"),
  };
  return fold;
}

function buildService({
  scope,
  pipelineName,
  eventStore,
  fold,
  featureFlagService,
}: {
  scope: AggregateScope | AggregateType;
  pipelineName: string;
  eventStore: EventStoreMemory<Event>;
  fold: FoldProjectionDefinition<LedgerState, Event>;
  featureFlagService?: FeatureFlagServiceInterface;
}) {
  return new EventSourcingService<Event, { ledger: LedgerProjection }>({
    pipelineName,
    aggregateScope: scope,
    eventStore,
    foldProjections: [fold],
    featureFlagService,
  });
}

describe("projections on a multi-aggregate pipeline", () => {
  const tenantId = createTestTenantId("org_1");
  const context = { tenantId };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_CONSTANTS.BASE_TIMESTAMP);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("given a grant and a role that share an id", () => {
    /** @scenario "Fold state on a multi-aggregate pipeline is keyed by type and id" */
    it("keeps one fold row per aggregate type, neither overwriting the other", async () => {
      const repo = new MemoryProjectionRepository();
      const eventStore = new EventStoreMemory<Event>();
      const service = buildService({
        scope: authzScope,
        pipelineName: "authz_grant",
        eventStore,
        fold: ledgerFold(repo, [GRANT_ATTACHED, ROLE_DEFINED]),
      });

      await service.storeEvents(
        [
          createTestEvent("x1", GRANT, tenantId, GRANT_ATTACHED, 1_000),
          createTestEvent("x1", ROLE, tenantId, ROLE_DEFINED, 2_000),
        ],
        context,
      );

      expect(repo.rowKeys.sort()).toEqual(["authz_grant:x1", "authz_role:x1"]);
      const grant = await service.getProjectionByName("ledger", "x1", context, {
        aggregateType: GRANT,
      });
      const role = await service.getProjectionByName("ledger", "x1", context, {
        aggregateType: ROLE,
      });
      expect(grant?.data.seen).toHaveLength(1);
      expect(role?.data.seen).toHaveLength(1);
      expect(grant?.data.seen).not.toEqual(role?.data.seen);
    });

    it("refuses a read that does not say which aggregate it wants", async () => {
      const service = buildService({
        scope: authzScope,
        pipelineName: "authz_grant",
        eventStore: new EventStoreMemory<Event>(),
        fold: ledgerFold(new MemoryProjectionRepository(), [GRANT_ATTACHED]),
      });

      await expect(
        service.getProjectionByName("ledger", "x1", context),
      ).rejects.toThrow(/needs options\.aggregateType/);
    });
  });

  describe("given a single-type pipeline", () => {
    /** @scenario "Fold state on a single-aggregate pipeline keeps the bare id as its key" */
    it("keys the fold row by the bare aggregate id", async () => {
      const repo = new MemoryProjectionRepository();
      const service = buildService({
        scope: "trace",
        pipelineName: "trace_processing",
        eventStore: new EventStoreMemory<Event>(),
        fold: ledgerFold(repo, [SPAN_RECEIVED]),
      });

      await service.storeEvents(
        [createTestEvent("t1", "trace", tenantId, SPAN_RECEIVED)],
        context,
      );

      expect(repo.rowKeys).toEqual(["t1"]);
      const row = await service.getProjectionByName("ledger", "t1", context);
      expect(row?.data.seen).toHaveLength(1);
    });
  });

  describe("given role events already folded at T1 and T3", () => {
    /** @scenario "A re-fold loads the history of the event's own aggregate type" */
    it("re-folds from the role's own history when T2 arrives out of order", async () => {
      const repo = new MemoryProjectionRepository();
      const eventStore = new EventStoreMemory<Event>();
      const getEvents = vi.spyOn(eventStore, "getEvents");
      const service = buildService({
        scope: authzScope,
        pipelineName: "authz_grant",
        eventStore,
        fold: ledgerFold(repo, [GRANT_ATTACHED, ROLE_DEFINED]),
      });
      const t1 = createTestEvent("r1", ROLE, tenantId, ROLE_DEFINED, 1_000);
      const t3 = createTestEvent("r1", ROLE, tenantId, ROLE_DEFINED, 3_000);
      const t2 = createTestEvent("r1", ROLE, tenantId, ROLE_DEFINED, 2_000);
      // A grant with the same id makes a type-blind re-fold observable.
      const g1 = createTestEvent("r1", GRANT, tenantId, GRANT_ATTACHED, 500);

      await service.storeEvents([g1, t1, t3], context);
      await service.storeEvents([t2], context);

      expect(getEvents).toHaveBeenCalledWith(
        "r1",
        { tenantId: createTenantId(String(tenantId)) },
        ROLE,
        2_000,
      );
      const role = await service.getProjectionByName("ledger", "r1", context, {
        aggregateType: ROLE,
      });
      expect(role?.data.seen).toEqual([t1.id, t2.id, t3.id]);
    });
  });

  describe("given a fold that re-folds on a store miss", () => {
    /** @scenario "A store-miss re-fold pages the event's own aggregate type" */
    it("pages the history of the delivered event's aggregate type", async () => {
      const repo = new MemoryProjectionRepository();
      const eventStore = new EventStoreMemory<Event>();
      const getEventsUpTo = vi.spyOn(eventStore, "getEventsUpTo");
      const getEventsUpToPaged = vi.spyOn(eventStore, "getEventsUpToPaged");
      const fold = ledgerFold(repo, [GRANT_ATTACHED, ROLE_DEFINED]);
      fold.options = { refoldOnStoreMiss: true, refoldOnOutOfOrder: false };
      const service = buildService({
        scope: authzScope,
        pipelineName: "authz_grant",
        eventStore,
        fold,
      });
      const first = createTestEvent(
        "g1",
        GRANT,
        tenantId,
        GRANT_ATTACHED,
        1_000,
      );
      const second = createTestEvent(
        "g1",
        GRANT,
        tenantId,
        GRANT_ATTACHED,
        2_000,
      );

      await service.storeEvents([first], context);
      repo.clear();
      await service.storeEvents([second], context);

      expect(getEventsUpToPaged).toHaveBeenCalledWith(
        expect.objectContaining({ aggregateId: "g1", aggregateType: GRANT }),
      );
      expect(getEventsUpTo).not.toHaveBeenCalled();
    });
  });

  describe("given the projection kill switch is consulted", () => {
    /** @scenario "A projection's kill-switch key on a multi-aggregate pipeline uses the pipeline name" */
    it("uses the pipeline name as the aggregate segment", async () => {
      const isEnabled = vi.fn().mockResolvedValue(false);
      const service = buildService({
        scope: authzScope,
        pipelineName: "authz_grant",
        eventStore: new EventStoreMemory<Event>(),
        fold: ledgerFold(new MemoryProjectionRepository(), [GRANT_ATTACHED]),
        featureFlagService: {
          isEnabled,
        } as unknown as FeatureFlagServiceInterface,
      });

      await service.storeEvents(
        [createTestEvent("g1", GRANT, tenantId, GRANT_ATTACHED)],
        context,
      );

      expect(isEnabled).toHaveBeenCalledWith(
        "es-authz_grant-projection-ledger-killswitch",
        expect.anything(),
      );
    });

    /** @scenario "A single-aggregate pipeline is unchanged" */
    it("keeps the aggregate type as the segment on a single-type pipeline", async () => {
      const isEnabled = vi.fn().mockResolvedValue(false);
      const service = buildService({
        scope: "trace",
        pipelineName: "trace_processing",
        eventStore: new EventStoreMemory<Event>(),
        fold: ledgerFold(new MemoryProjectionRepository(), [SPAN_RECEIVED]),
        featureFlagService: {
          isEnabled,
        } as unknown as FeatureFlagServiceInterface,
      });

      await service.storeEvents(
        [createTestEvent("t1", "trace", tenantId, SPAN_RECEIVED)],
        context,
      );

      expect(isEnabled).toHaveBeenCalledWith(
        "es-trace-projection-ledger-killswitch",
        expect.anything(),
      );
    });
  });
});
