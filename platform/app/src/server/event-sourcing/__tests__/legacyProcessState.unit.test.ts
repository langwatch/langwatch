/**
 * The rewrite kept the three `ProcessManager*` Prisma models and their rows, so
 * every process manager still meets state its predecessor wrote. A deployed row
 * carries no state version (`stateVersion` is NULL, which the store reads as the
 * legacy sentinel), so the version gate waves it through and the state schema is
 * the only thing standing between it and an `UndecodableStateError` — which is
 * not genesis, and wedges that instance rather than restarting it.
 *
 * These drive the real read-evolve-write cycle against rows shaped exactly as
 * `event-sourcing.old` wrote them. A schema that gains a required field, or
 * renames one, fails here.
 */

import {
  type BuiltProcessManager,
  createProcessRuntime,
  memoryClock,
  memoryOutbox,
  memoryProcessStore,
  type ProcessInstanceKey,
} from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import { createAutomationsPipeline } from "../automations";
import { createBillingReportingPipeline } from "../billing-reporting";
import { createSimulationProcessingPipeline } from "../simulation-processing";

const TENANT = "project-legacy";

function harness(now: number) {
  const clock = memoryClock(now);
  const processStore = memoryProcessStore();
  const outbox = memoryOutbox(clock);
  return {
    processStore,
    outbox,
    runtime: createProcessRuntime({ processStore, outbox, clock }),
  };
}

/** Writes a row the way the previous implementation did: the state shape it
 *  knew, and no version stamp at all. */
async function seedLegacyRow(
  processStore: ReturnType<typeof memoryProcessStore>,
  key: ProcessInstanceKey,
  state: unknown,
): Promise<void> {
  await processStore.save({
    key,
    tenantId: TENANT,
    state,
    stateVersion: "",
    expectedRevision: 0,
    nextWakeAt: null,
  });
}

const fakeClient = () =>
  ({
    query: vi.fn().mockResolvedValue({ header: [], rows: [] }),
    insert: vi.fn().mockResolvedValue(undefined),
    resolveClient: vi.fn(),
  }) as never;

describe("given a process-manager row written by the previous implementation", () => {
  describe("when the simulation run's execution process wakes on it", () => {
    /** @scenario a deployed scenarioExecution row still decodes, and the set id
     * it stored under the deployed key still reaches the terminal write */
    it("decodes the deployed `setId` spelling and carries it into failRun", async () => {
      const emitFailure = vi.fn().mockResolvedValue(undefined);
      const built = createSimulationProcessingPipeline({
        client: fakeClient(),
        scenarioExecution: {
          executeRun: vi.fn(),
          readRunStatus: vi.fn().mockResolvedValue("QUEUED"),
          emitFailure,
        },
      });
      const manager = built.processManagers
        .scenarioExecution as BuiltProcessManager;
      const key: ProcessInstanceKey = {
        processName: "scenarioExecution",
        projectId: TENANT,
        processKey: "run-legacy",
      };
      const { processStore, outbox, runtime } = harness(50_000);

      await seedLegacyRow(processStore, key, {
        scenarioRunId: "run-legacy",
        scenarioId: "scenario-1",
        batchRunId: "batch-1",
        setId: "set-1",
        target: { type: "prompt", referenceId: "p1" },
        cancelRequested: false,
        settled: false,
      });

      const { ran } = await runtime.wake(manager, { key, tenantId: TENANT });

      expect(ran).toBe(true);
      const staged = await outbox.claim(10, 1000);
      expect(staged).toHaveLength(1);
      expect(JSON.parse(staged[0]!.payload)).toMatchObject({
        scenarioRunId: "run-legacy",
        setId: "set-1",
        outcome: "stalled",
      });
    });
  });

  describe("when a sweep process that gained a wake field is delivered an event", () => {
    /** @scenario a deployed sweep row that predates `nextWakeAt` decodes as
     * "nothing armed yet" rather than failing */
    it.each([
      [
        "graphAlertSweep",
        () =>
          createAutomationsPipeline({
            dispatch: {
              triggerIsActive: vi.fn().mockResolvedValue(false),
              confirmSettledMatch: vi.fn(),
              isSendClaimed: vi.fn(),
              claimSend: vi.fn(),
              sendNotifyDigest: vi.fn(),
              runPersistAction: vi.fn(),
            },
            sweep: {
              decideSweepCandidates: vi.fn().mockResolvedValue([]),
              evaluateGraphTrigger: vi.fn(),
              pruneDispatchedIntentsBefore: vi.fn().mockResolvedValue(0),
            },
            prune: {
              pruneExpiredDeliveries: vi.fn().mockResolvedValue(0),
              pruneDispatchedIntentsBefore: vi.fn().mockResolvedValue(0),
            },
          }),
        { lastSweepAt: 40_000 },
      ],
      [
        "webhookDeliveryPrune",
        () =>
          createAutomationsPipeline({
            dispatch: {
              triggerIsActive: vi.fn().mockResolvedValue(false),
              confirmSettledMatch: vi.fn(),
              isSendClaimed: vi.fn(),
              claimSend: vi.fn(),
              sendNotifyDigest: vi.fn(),
              runPersistAction: vi.fn(),
            },
            sweep: {
              decideSweepCandidates: vi.fn().mockResolvedValue([]),
              evaluateGraphTrigger: vi.fn(),
              pruneDispatchedIntentsBefore: vi.fn().mockResolvedValue(0),
            },
            prune: {
              pruneExpiredDeliveries: vi.fn().mockResolvedValue(0),
              pruneDispatchedIntentsBefore: vi.fn().mockResolvedValue(0),
            },
          }),
        { lastPruneAt: 40_000 },
      ],
    ])("%s decodes a row with no nextWakeAt", async (name, build, legacy) => {
      const built = build();
      const manager = built.processManagers[name] as BuiltProcessManager;
      const key: ProcessInstanceKey = {
        processName: name,
        projectId: TENANT,
        processKey: "singleton",
      };
      const { processStore, runtime } = harness(50_000);
      await seedLegacyRow(processStore, key, legacy);

      await expect(
        runtime.wake(manager, { key, tenantId: TENANT }),
      ).resolves.toMatchObject({ ran: true });
      // Re-read rather than trust the wake's return: this is the write the
      // next wake will decode, so it is the one that has to be well-formed.
      const stored = await processStore.load(key);
      expect(stored?.stateVersion).toBe(manager.stateVersion);
    });
  });

  describe("when the billing meter sweep is woken on a row that predates its wake field", () => {
    /** @scenario a deployed billingMeterSweep row decodes and re-arms */
    it("decodes and stamps the current state version", async () => {
      const built = createBillingReportingPipeline({
        client: fakeClient(),
        organizations: { getOrganizationForBilling: vi.fn() },
        billingCheckpoints: {
          getCheckpoint: vi.fn().mockResolvedValue(null),
          recordCheckpoint: vi.fn(),
        },
        getUsageReportingService: () => undefined,
        queryBillableEventsTotal: vi.fn().mockResolvedValue(0),
        listOrganizationsToReport: vi.fn().mockResolvedValue([]),
        pruneDispatchedIntentsBefore: vi.fn().mockResolvedValue(0),
        isSaas: false,
      } as never);
      const manager = built.processManagers
        .billingMeterSweep as BuiltProcessManager;
      const key: ProcessInstanceKey = {
        processName: "billingMeterSweep",
        projectId: TENANT,
        processKey: "singleton",
      };
      const { processStore, runtime } = harness(50_000);
      await seedLegacyRow(processStore, key, { lastSweepAt: 40_000 });

      await expect(
        runtime.wake(manager, { key, tenantId: TENANT }),
      ).resolves.toMatchObject({ ran: true });
      const stored = await processStore.load(key);
      expect(stored?.stateVersion).toBe(manager.stateVersion);
    });
  });
});
