/**
 * The settlement sweeper end to end: ONE scheduled process instance for the
 * install asks the spend record which admissions are still open past their
 * grace and settles each one, and the fold (against real ClickHouse) records
 * the settled row that a late confirmation then supersedes. The definition
 * under test is the exact one the runtime mounts, built through the
 * pipeline's own applier.
 */

import type { ProcessEventEnvelope } from "@langwatch/eventing";
import {
  buildIntentHandlers,
  buildProcessDefinition,
  buildProcessManager,
  InMemoryProcessStore,
  OutboxDispatcherService,
  type ProcessDefinition,
  ProcessManagerService,
  SCHEDULE_ARM_EVENT_TYPE,
  SCHEDULED_SINGLETON_PROJECT_ID,
} from "@langwatch/eventing";
import { nanoid } from "nanoid";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OpenAdmission,
  SpendSettlementProcessDeps,
  SpendSettlementState,
} from "@langwatch/gateway-server";
import {
  SETTLEMENT_SWEEP_INTERVAL_MS,
  SPEND_SETTLEMENT_PROCESS_NAME,
  spendSettlementPM,
} from "@langwatch/gateway-server";

const ns = `settle-pm-${nanoid(8)}`;
const T0 = Date.UTC(2026, 6, 21, 9, 0, 0);
const GRACE_MS = 60_000;
const PROJECT = `project-${ns}`;

let store: InMemoryProcessStore;
let service: ProcessManagerService<SpendSettlementState>;
let dispatcher: OutboxDispatcherService;
let sendSettleSpend: ReturnType<typeof vi.fn>;
let findOpenAdmissions: ReturnType<typeof vi.fn>;
let clock: number;

function buildDefinition(deps: SpendSettlementProcessDeps) {
  return buildProcessDefinition(
    buildProcessManager({
      name: SPEND_SETTLEMENT_PROCESS_NAME,
      applier: spendSettlementPM(deps),
    }).config,
  ) as ProcessDefinition<SpendSettlementState>;
}

const singletonRef = {
  processName: SPEND_SETTLEMENT_PROCESS_NAME,
  projectId: SCHEDULED_SINGLETON_PROJECT_ID,
  processKey: SPEND_SETTLEMENT_PROCESS_NAME,
};

function openAdmission(overrides: Partial<OpenAdmission> = {}): OpenAdmission {
  return {
    tenantId: PROJECT,
    gatewayRequestId: `${ns}-req`,
    organizationId: "org-settle",
    virtualKeyId: "vk-settle",
    principalUserId: "user-settle",
    endUserId: "end-user-settle",
    traceId: "trace-settle",
    requestType: "chat",
    labels: ["a"],
    metadata: "",
    admittedAtMs: T0,
    model: "openai/gpt-5",
    providerKey: "prov-1",
    ...overrides,
  };
}

/** Drives the runtime's schedule arming, which is what creates the one
 *  instance this process has and gives it its first wake. */
async function armSchedule(): Promise<void> {
  const envelope: ProcessEventEnvelope = {
    eventId: `schedule-arm:${ns}`,
    eventType: SCHEDULE_ARM_EVENT_TYPE,
    occurredAt: clock,
    tenantId: SCHEDULED_SINGLETON_PROJECT_ID,
    projectId: SCHEDULED_SINGLETON_PROJECT_ID,
    processKey: SPEND_SETTLEMENT_PROCESS_NAME,
    payload: {},
  };
  await service.handleEvent({ envelope, now: clock });
}

async function instance() {
  return store.findByRef<SpendSettlementState>({ ref: singletonRef });
}

/** Fires the due wake, reporting whether it committed. */
async function fireWake(): Promise<boolean> {
  const current = await instance();
  if (!current || current.nextWakeAt === null) return false;
  const result = await service.handleWake({
    wake: {
      ref: singletonRef,
      revision: current.revision,
      wakeAt: current.nextWakeAt,
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
  findOpenAdmissions = vi.fn().mockResolvedValue([]);
  const deps: SpendSettlementProcessDeps = {
    sendSettleSpend:
      sendSettleSpend as unknown as SpendSettlementProcessDeps["sendSettleSpend"],
    findOpenAdmissions:
      findOpenAdmissions as unknown as SpendSettlementProcessDeps["findOpenAdmissions"],
    graceMs: GRACE_MS,
    now: () => clock,
  };
  store = InMemoryProcessStore.createForTesting();
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
  describe("given one process instance for the whole install", () => {
    /** @scenario Settlement keeps one process instance for the install, not one per request */
    it("keeps a single instance no matter how many requests it settles", async () => {
      await armSchedule();
      findOpenAdmissions.mockResolvedValue([
        openAdmission({ gatewayRequestId: `${ns}-a` }),
        openAdmission({ gatewayRequestId: `${ns}-b`, tenantId: "other" }),
        openAdmission({ gatewayRequestId: `${ns}-c` }),
      ]);

      clock = T0 + SETTLEMENT_SWEEP_INTERVAL_MS + 1;
      expect(await fireWake()).toBe(true);
      await drainOutbox();

      expect(sendSettleSpend).toHaveBeenCalledTimes(3);
      // Every instance this process owns, found through the port the wake
      // worker itself scans with. Three settled requests, one row: under the
      // per-request timer this would have been three rows, in a table with
      // no retention sweep to remove them.
      const instances = await store.findDueWakes({
        now: clock + SETTLEMENT_SWEEP_INTERVAL_MS * 10,
        limit: 100,
        processNames: [SPEND_SETTLEMENT_PROCESS_NAME],
      });
      expect(instances).toHaveLength(1);
      expect(instances[0]?.ref.processKey).toBe(SPEND_SETTLEMENT_PROCESS_NAME);
    });

    /** @scenario The sweeper re-arms itself after every wake */
    it("re-arms the next sweep from the present", async () => {
      await armSchedule();
      expect((await instance())?.nextWakeAt).toBe(T0 + SETTLEMENT_SWEEP_INTERVAL_MS);

      clock = T0 + SETTLEMENT_SWEEP_INTERVAL_MS + 1;
      expect(await fireWake()).toBe(true);
      expect((await instance())?.nextWakeAt).toBe(clock + SETTLEMENT_SWEEP_INTERVAL_MS);
    });
  });

  describe("when admissions are open past their grace", () => {
    /** @scenario A settled request names the organization it belonged to */
    it("settles each one, carrying the attribution the fold recorded", async () => {
      await armSchedule();
      findOpenAdmissions.mockResolvedValue([
        openAdmission({ gatewayRequestId: `${ns}-silent` }),
      ]);

      clock = T0 + SETTLEMENT_SWEEP_INTERVAL_MS + 1;
      expect(await fireWake()).toBe(true);
      await drainOutbox();

      expect(findOpenAdmissions).toHaveBeenCalledWith(
        expect.objectContaining({ graceMs: GRACE_MS }),
      );
      expect(sendSettleSpend).toHaveBeenCalledTimes(1);
      expect(sendSettleSpend).toHaveBeenCalledWith(
        expect.objectContaining({
          gateway_request_id: `${ns}-silent`,
          tenantId: PROJECT,
          reason: "confirmation_deadline_expired",
          organization_id: "org-settle",
          virtual_key_id: "vk-settle",
          principal_user_id: "user-settle",
          end_user_id: "end-user-settle",
          trace_id: "trace-settle",
          request_type: "chat",
          labels: ["a"],
          admitted_at: T0,
          // Settlement resolved no model of its own, so it carries the one
          // admission requested — without this a settled webhook envelope
          // names no model at all.
          model: "openai/gpt-5",
          model_provider_id: "prov-1",
        }),
      );
    });

    /** @scenario An unconfirmed admission settles when the grace expires */
    it("issues settleSpend for an admission the grace has passed", async () => {
      await armSchedule();
      findOpenAdmissions.mockResolvedValue([
        openAdmission({ gatewayRequestId: `${ns}-expired` }),
      ]);

      clock = T0 + SETTLEMENT_SWEEP_INTERVAL_MS + 1;
      expect(await fireWake()).toBe(true);
      await drainOutbox();

      expect(sendSettleSpend).toHaveBeenCalledTimes(1);
      expect(sendSettleSpend).toHaveBeenCalledWith(
        expect.objectContaining({
          gateway_request_id: `${ns}-expired`,
          reason: "confirmation_deadline_expired",
        }),
      );
    });

    /** @scenario One tenant's failed settle does not cost the rest of the sweep */
    it("settles the others when one send fails", async () => {
      await armSchedule();
      findOpenAdmissions.mockResolvedValue([
        openAdmission({ gatewayRequestId: `${ns}-bad` }),
        openAdmission({ gatewayRequestId: `${ns}-good` }),
      ]);
      sendSettleSpend.mockRejectedValueOnce(new Error("append refused"));

      clock = T0 + SETTLEMENT_SWEEP_INTERVAL_MS + 1;
      expect(await fireWake()).toBe(true);
      await drainOutbox();

      expect(sendSettleSpend).toHaveBeenCalledTimes(2);
      expect(sendSettleSpend).toHaveBeenLastCalledWith(
        expect.objectContaining({ gateway_request_id: `${ns}-good` }),
      );
    });
  });

  describe("when nothing is open", () => {
    /** @scenario A sweep that finds nothing settles nothing */
    it("sends no settle command", async () => {
      await armSchedule();
      clock = T0 + SETTLEMENT_SWEEP_INTERVAL_MS + 1;
      expect(await fireWake()).toBe(true);
      await drainOutbox();

      expect(findOpenAdmissions).toHaveBeenCalledTimes(1);
      expect(sendSettleSpend).not.toHaveBeenCalled();
    });
  });
});
