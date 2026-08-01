/**
 * The M2 settlement sweeper end to end: the process manager arms a wake at
 * admission + grace, a wake with no outcome issues settleSpend, and the
 * fold (against real ClickHouse) records the settled row that a late
 * confirmation then supersedes. The definition under test is the exact one
 * the runtime mounts, built through the pipeline's own applier.
 */

import { nanoid } from "nanoid";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import {
  type HandleResult,
  InMemoryProcessStore,
  type ProcessDefinition,
  ProcessManagerService,
} from "~/server/event-sourcing/process-manager";
import { OutboxDispatcherService } from "~/server/event-sourcing/process-manager/outbox/outboxDispatcherService";
import type { ProcessEventEnvelope } from "~/server/event-sourcing/process-manager/processManager.types";
import {
  buildIntentHandlers,
  buildProcessDefinition,
} from "~/server/event-sourcing/process-manager/processRuntime";
import {
  SPEND_SETTLEMENT_PROCESS_NAME,
  type SpendSettlementProcessDeps,
  type SpendSettlementState,
  spendSettlementPM,
} from "../process-manager/spendSettlement.process";
import {
  GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  GATEWAY_SPEND_SETTLED_EVENT_TYPE,
} from "../schemas/constants";

const ns = `settle-pm-${nanoid(8)}`;
const T0 = Date.UTC(2026, 6, 21, 9, 0, 0);
const GRACE_MS = 60_000;
const PROJECT = `project-${ns}`;

let store: InMemoryProcessStore;
let service: ProcessManagerService<SpendSettlementState>;
let dispatcher: OutboxDispatcherService;
let sendSettleSpend: ReturnType<typeof vi.fn>;
let clock: number;

function buildDefinition(deps: SpendSettlementProcessDeps) {
  return buildProcessDefinition(
    buildProcessManager({
      name: SPEND_SETTLEMENT_PROCESS_NAME,
      applier: spendSettlementPM(deps),
    }).config,
  ) as ProcessDefinition<SpendSettlementState>;
}

function envelopeFor({
  requestId,
  eventType,
  data,
  occurredAt,
}: {
  requestId: string;
  eventType: string;
  data: Record<string, unknown>;
  occurredAt: number;
}): ProcessEventEnvelope {
  return {
    eventId: `${eventType}:${requestId}`,
    eventType,
    occurredAt,
    tenantId: PROJECT,
    projectId: PROJECT,
    processKey: requestId,
    payload: data as ProcessEventEnvelope["payload"],
  };
}

function admitted(requestId: string): ProcessEventEnvelope {
  return envelopeFor({
    requestId,
    eventType: GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
    data: { gateway_request_id: requestId, occurred_at: T0 },
    occurredAt: T0,
  });
}

function confirmed(requestId: string, at: number): ProcessEventEnvelope {
  return envelopeFor({
    requestId,
    eventType: GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
    data: { gateway_request_id: requestId, occurred_at: at },
    occurredAt: at,
  });
}

function settled(requestId: string, at: number): ProcessEventEnvelope {
  return envelopeFor({
    requestId,
    eventType: GATEWAY_SPEND_SETTLED_EVENT_TYPE,
    data: {
      gateway_request_id: requestId,
      occurred_at: at,
      reason: "confirmation_deadline_expired",
    },
    occurredAt: at,
  });
}

/**
 * Feeds one envelope through the process manager and reports the commit
 * outcome. Every caller asserts it is not a revisionConflict: a conflict
 * silently drops the event, which would make the rest of the case pass
 * against a process instance that never saw it.
 */
async function consume(
  envelope: ProcessEventEnvelope,
): Promise<HandleResult["outcome"]> {
  const result = await service.handleEvent({ envelope, now: clock });
  return result.outcome;
}

async function instanceFor(requestId: string) {
  return store.findByRef<SpendSettlementState>({
    ref: {
      processName: SPEND_SETTLEMENT_PROCESS_NAME,
      projectId: PROJECT,
      processKey: requestId,
    },
  });
}

async function fireWake(requestId: string): Promise<boolean> {
  const instance = await instanceFor(requestId);
  if (!instance || instance.nextWakeAt === null) return false;
  const result = await service.handleWake({
    wake: {
      ref: {
        processName: SPEND_SETTLEMENT_PROCESS_NAME,
        projectId: PROJECT,
        processKey: requestId,
      },
      revision: instance.revision,
      wakeAt: instance.nextWakeAt,
    },
    now: clock,
  });
  return result.outcome === "committed";
}

async function drainOutbox(passes = 4): Promise<void> {
  for (let i = 0; i < passes; i++) {
    clock += 1000;
    await dispatcher.runOnce({ now: clock, limit: 50 });
  }
}

beforeEach(() => {
  clock = T0;
  sendSettleSpend = vi.fn().mockResolvedValue(undefined);
  const deps: SpendSettlementProcessDeps = {
    sendSettleSpend:
      sendSettleSpend as unknown as SpendSettlementProcessDeps["sendSettleSpend"],
    graceMs: GRACE_MS,
    now: () => clock,
  };
  store = new InMemoryProcessStore();
  const definition = buildDefinition(deps);
  service = new ProcessManagerService<SpendSettlementState>({
    store,
    definition,
  });
  dispatcher = new OutboxDispatcherService({
    store,
    handlers: buildIntentHandlers(
      buildProcessManager({
        name: SPEND_SETTLEMENT_PROCESS_NAME,
        applier: spendSettlementPM(deps),
      }).config,
    ),
    processNames: [SPEND_SETTLEMENT_PROCESS_NAME],
  });
});

describe("spend settlement sweeper", () => {
  /** @scenario An unconfirmed admission settles when the grace expires */
  it("arms admission + grace and settles on a silent wake", async () => {
    const requestId = `${ns}-silent`;
    expect(await consume(admitted(requestId))).not.toBe("revisionConflict");

    const armed = await instanceFor(requestId);
    expect(armed?.nextWakeAt).toBe(T0 + GRACE_MS);

    clock = T0 + GRACE_MS + 1;
    expect(await fireWake(requestId)).toBe(true);
    await drainOutbox();

    expect(sendSettleSpend).toHaveBeenCalledTimes(1);
    expect(sendSettleSpend).toHaveBeenCalledWith({
      gateway_request_id: requestId,
      tenantId: PROJECT,
      occurred_at: expect.any(Number),
      reason: "confirmation_deadline_expired",
    });

    // The settled event coming back around closes the instance for good:
    // a stray second wake stands down.
    expect(await consume(settled(requestId, clock))).not.toBe(
      "revisionConflict",
    );
    const closed = await instanceFor(requestId);
    expect(closed?.state.resolved).toBe(true);
    expect(closed?.nextWakeAt).toBeNull();
  });

  /** @scenario A confirmation inside the grace stands the sweeper down */
  it("clears the wake when the confirmation arrives in time", async () => {
    const requestId = `${ns}-confirmed`;
    expect(await consume(admitted(requestId))).not.toBe("revisionConflict");
    clock = T0 + 5_000;
    expect(await consume(confirmed(requestId, clock))).not.toBe(
      "revisionConflict",
    );

    const instance = await instanceFor(requestId);
    expect(instance?.state.resolved).toBe(true);
    expect(instance?.nextWakeAt).toBeNull();

    clock = T0 + GRACE_MS + 1;
    expect(await fireWake(requestId)).toBe(false);
    await drainOutbox();
    expect(sendSettleSpend).not.toHaveBeenCalled();
  });

  /** @scenario An outcome racing ahead of its admission arms no wake */
  it("does not arm when the outcome was seen before the admission", async () => {
    const requestId = `${ns}-raced`;
    clock = T0 + 1_000;
    expect(await consume(confirmed(requestId, clock))).not.toBe(
      "revisionConflict",
    );
    expect(await consume(admitted(requestId))).not.toBe("revisionConflict");

    const instance = await instanceFor(requestId);
    expect(instance?.state.resolved).toBe(true);
    expect(instance?.nextWakeAt).toBeNull();
  });

  /** @scenario Duplicate wakes cannot double-settle */
  it("issues settle exactly once across duplicate wakes", async () => {
    const requestId = `${ns}-dupe`;
    expect(await consume(admitted(requestId))).not.toBe("revisionConflict");
    clock = T0 + GRACE_MS + 1;
    expect(await fireWake(requestId)).toBe(true);
    // The first wake consumed nextWakeAt; a second due scan finds nothing.
    expect(await fireWake(requestId)).toBe(false);
    await drainOutbox();
    expect(sendSettleSpend).toHaveBeenCalledTimes(1);
  });
});

describe("settlement on the spend record (real ClickHouse)", () => {
  /** @scenario The full settlement sequence: silent admission settles, a late confirmation supersedes */
  it("folds admit, settle, then a late confirm superseding the settled row", async () => {
    const { startTestContainers, stopTestContainers } = await import(
      "~/server/event-sourcing/__tests__/integration/testContainers"
    );
    const { GatewaySpendEventsRepository } = await import(
      "~/server/gateway/spendEvents.clickhouse.repository"
    );
    const { GatewaySpendFoldProjection } = await import(
      "../projections/gatewaySpend.foldProjection"
    );
    const { GatewaySpendStore } = await import(
      "../projections/gatewaySpend.store"
    );
    const { spendRowToEnvelope } = await import("@ee/webhooks/envelope");
    const { EventUtils, createTenantId } = await import(
      "~/server/event-sourcing"
    );
    const constants = await import("../schemas/constants");

    const containers = await startTestContainers();
    const repo = new GatewaySpendEventsRepository(
      async () => containers.clickHouseClient,
    );
    const foldStore = new GatewaySpendStore(repo);
    const projection = new GatewaySpendFoldProjection({
      store: foldStore as never,
    });
    const tenant = `settle-fold-${ns}`;
    const requestId = `req-${ns}`;
    const context = {
      tenantId: createTenantId(tenant),
      aggregateId: requestId,
    };

    const makeEvent = (
      type: string,
      data: Record<string, unknown>,
      at: number,
    ) =>
      EventUtils.createEvent({
        aggregateType: constants.GATEWAY_SPEND_AGGREGATE_TYPE,
        aggregateId: requestId,
        tenantId: createTenantId(tenant),
        type,
        version: constants.GATEWAY_SPEND_EVENT_VERSION_LATEST,
        data,
        metadata: {},
        occurredAt: at,
        idempotencyKey: `${tenant}:${requestId}:${type}:${at}`,
      } as never) as never;

    try {
      // 1. Admission with no outcome: the record exists, cost unknown.
      const admittedState = projection.handleGatewaySpendAdmitted(
        makeEvent(
          constants.GATEWAY_SPEND_ADMITTED_EVENT_TYPE,
          {
            gateway_request_id: requestId,
            occurred_at: T0,
            organization_id: "org-settle",
            tenantId: tenant,
            virtual_key_id: "vk-settle",
            principal_user_id: "",
            end_user_id: "settle-user",
            model: "openai/gpt-5",
            model_provider_id: "prov-1",
            trace_id: "",
            request_type: "chat",
            labels: [],
            metadata: "",
            pod_id: "pod-1",
            pod_seq: 1,
          },
          T0,
        ),
        projection.init(),
      );
      await foldStore.store(admittedState, context);

      // 2. The sweeper settles: unknown is recorded, never zeroed away.
      const settledState = projection.handleGatewaySpendSettled(
        makeEvent(
          constants.GATEWAY_SPEND_SETTLED_EVENT_TYPE,
          {
            gateway_request_id: requestId,
            occurred_at: T0 + GRACE_MS,
            tenantId: tenant,
            reason: "confirmation_deadline_expired",
          },
          T0 + GRACE_MS,
        ),
        admittedState,
      );
      await foldStore.store(settledState, context);

      const afterSettle = await repo.readSpendEventsPage({
        tenantId: tenant,
        fromMs: T0 - 1000,
        toMs: T0 + GRACE_MS * 2,
        filters: {},
        limit: 10,
      });
      expect(afterSettle.rows).toHaveLength(1);
      expect(afterSettle.rows[0]!.status).toBe("settled");
      expect(afterSettle.rows[0]!.needsReconciliation).toBe(true);
      const settledEnvelope = spendRowToEnvelope(afterSettle.rows[0]!);
      expect(settledEnvelope.type).toBe("gateway.request.settled");
      expect(settledEnvelope.data.cost).toBeNull();
      expect(settledEnvelope.data.usage).toBeNull();

      // 3. The late confirmation supersedes: replace, never sum.
      const confirmedState = projection.handleGatewaySpendConfirmed(
        makeEvent(
          constants.GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
          {
            gateway_request_id: requestId,
            occurred_at: T0 + GRACE_MS + 5_000,
            tenantId: tenant,
            model: "openai/gpt-5",
            model_provider_id: "prov-1",
            usage: {
              input_tokens: 500,
              output_tokens: 100,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
              reasoning_tokens: 0,
            },
            rate_version: "",
            duration_ms: 2_000,
          },
          T0 + GRACE_MS + 5_000,
        ),
        settledState,
      );
      await foldStore.store(confirmedState, context);

      const afterConfirm = await repo.readSpendEventsPage({
        tenantId: tenant,
        fromMs: T0 - 1000,
        toMs: T0 + GRACE_MS * 2,
        filters: {},
        limit: 10,
      });
      expect(afterConfirm.rows).toHaveLength(1);
      expect(afterConfirm.rows[0]!.status).toBe("confirmed");
      expect(afterConfirm.rows[0]!.needsReconciliation).toBe(false);
      expect(afterConfirm.rows[0]!.costNanoUsd).toBeGreaterThan(0);
      const completedEnvelope = spendRowToEnvelope(afterConfirm.rows[0]!);
      expect(completedEnvelope.type).toBe("gateway.request.completed");
      expect(completedEnvelope.id).toBe(`${requestId}:completed`);
      expect(completedEnvelope.data.gateway_request_id).toBe(requestId);
    } finally {
      await containers.clickHouseClient.command({
        query: `ALTER TABLE gateway_spend DELETE WHERE TenantId = '${tenant}'`,
      });
      await stopTestContainers();
    }
  }, 180_000);
});
