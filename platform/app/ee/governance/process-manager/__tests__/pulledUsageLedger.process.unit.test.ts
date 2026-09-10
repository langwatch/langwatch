// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The reissue detector: what the process manager WITHDRAWS, and what it
 * refuses to.
 *
 * The definition under test is the exact one the runtime mounts, built through
 * the pipeline's own applier and driven through the real process service and
 * the real outbox dispatcher, so the ordering these assertions depend on is
 * the runtime's rather than the test's.
 *
 * Every version of one charge arrives on ONE process instance, because the
 * process key is the restatement key. That is the whole mechanism: it is the
 * only place where the cell a charge sits in and the cell the next pull is
 * about to land in are ever both in scope.
 *
 * Spec: specs/governance/governance-cost-rollup.feature
 * Decision: ADR-088, ADR-128.
 */

import { PULLED_USAGE_EVENT_TYPES } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/constants";
import type { PulledUsageObservedEventData } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/events";
import { nanoid } from "nanoid";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import {
  InMemoryProcessStore,
  type ProcessDefinition,
  ProcessManagerService,
} from "~/server/event-sourcing/process-manager";
import type { JsonValue } from "~/server/event-sourcing/process-manager/json";
import { OutboxDispatcherService } from "~/server/event-sourcing/process-manager/outbox/outboxDispatcherService";
import type { ProcessEventEnvelope } from "~/server/event-sourcing/process-manager/processManager.types";
import {
  buildIntentHandlers,
  buildProcessDefinition,
} from "~/server/event-sourcing/process-manager/processRuntime";

import {
  PULLED_USAGE_LEDGER_PROCESS_NAME,
  type PulledUsageLedgerProcessDeps,
  type PulledUsageLedgerState,
  pulledUsageLedgerPM,
} from "../pulledUsageLedger.process";

const ns = `pulled-pm-${nanoid(8)}`;
const T0 = Date.UTC(2026, 7, 3, 0, 0, 0);
const GOV_PROJECT = `proj-gov-${ns}`;
const ORG_ID = `org-${ns}`;
const TEAM_ID = `team-${ns}`;
const SOURCE = "azure_cost_management";
const INGESTION_SOURCE_ID = `src-${ns}`;

/** The day the charge falls in. Every version below corrects THIS day. */
const OCCURRED_AT = Date.UTC(2026, 7, 1, 0, 0, 0);

let store: InMemoryProcessStore;
let service: ProcessManagerService<PulledUsageLedgerState>;
let dispatcher: OutboxDispatcherService;
let sendRetractPulledUsage: ReturnType<typeof vi.fn>;
let insertPulledUsageRows: ReturnType<typeof vi.fn>;
let retractionEnabled: ReturnType<typeof vi.fn>;
let clock: number;

/**
 * One charge, one restatement key, one process instance. Shared across every
 * test so that every observation in a test lands on the same stream — which is
 * exactly the production shape, since the key is the aggregate id.
 */
const RESTATEMENT_KEY = `example:${ns}:sub-1:2026-08-01`;

function observation(
  overrides: Partial<PulledUsageObservedEventData> = {},
): PulledUsageObservedEventData {
  return {
    itemKey: `item-${ns}`,
    restatementKey: RESTATEMENT_KEY,
    source: SOURCE,
    ingestionSourceId: INGESTION_SOURCE_ID,
    organizationId: ORG_ID,
    teamId: TEAM_ID,
    projectId: null,
    model: "azure/meter-cognitive-services",
    tokensInput: 0,
    tokensOutput: 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    costNanoMinor: 12_000_000_000,
    currencyCode: "USD",
    costNanoUsd: 12_000_000_000,
    rateVersion: null,
    costBasis: "provider_reported",
    costStatus: "exact",
    rawActorId: "",
    agentId: "",
    occurredAtMs: OCCURRED_AT,
    observedAtMs: T0,
    ...overrides,
  };
}

/**
 * Delivers one observation the way the live subscriber does, on the process
 * key the command's `aggregateId` gives it.
 */
async function observe(data: PulledUsageObservedEventData): Promise<void> {
  const envelope: ProcessEventEnvelope = {
    eventId: `obs:${data.restatementKey}:${data.observedAtMs}`,
    eventType: PULLED_USAGE_EVENT_TYPES.OBSERVED,
    occurredAt: data.occurredAtMs,
    tenantId: GOV_PROJECT,
    projectId: GOV_PROJECT,
    processKey: data.restatementKey,
    payload: data as unknown as JsonValue,
  };
  await service.handleEvent({ envelope, now: clock });
}

async function drainOutbox(passes = 4): Promise<void> {
  for (let i = 0; i < passes; i++) {
    clock += 1_000;
    await dispatcher.runOnce({ now: clock, limit: 50 });
  }
}

beforeEach(() => {
  clock = T0;
  sendRetractPulledUsage = vi.fn().mockResolvedValue(undefined);
  insertPulledUsageRows = vi.fn().mockResolvedValue(undefined);
  retractionEnabled = vi.fn().mockResolvedValue(true);
  const deps: PulledUsageLedgerProcessDeps = {
    budgetCHRepository: {
      insertPulledUsageRows,
    } as unknown as PulledUsageLedgerProcessDeps["budgetCHRepository"],
    sendRetractPulledUsage:
      sendRetractPulledUsage as unknown as PulledUsageLedgerProcessDeps["sendRetractPulledUsage"],
    retractionEnabled:
      retractionEnabled as unknown as PulledUsageLedgerProcessDeps["retractionEnabled"],
  };
  store = new InMemoryProcessStore();
  service = new ProcessManagerService<PulledUsageLedgerState>({
    store,
    definition: buildProcessDefinition(
      buildProcessManager({
        name: PULLED_USAGE_LEDGER_PROCESS_NAME,
        applier: pulledUsageLedgerPM(deps),
      }).config,
    ) as ProcessDefinition<PulledUsageLedgerState>,
  });
  dispatcher = new OutboxDispatcherService({
    store,
    handlers: buildIntentHandlers(
      buildProcessManager({
        name: PULLED_USAGE_LEDGER_PROCESS_NAME,
        applier: pulledUsageLedgerPM(deps),
      }).config,
    ),
    processNames: [PULLED_USAGE_LEDGER_PROCESS_NAME],
  });
});

describe("recognising a reissued charge", () => {
  describe("given a day's bill already pulled in one currency", () => {
    /** @scenario A bill reissued in another currency is withdrawn by the pull that finds it */
    it("withdraws the first currency's version when the next pull returns another currency", async () => {
      await observe(observation({ currencyCode: "EUR", costNanoUsd: null }));
      await observe(
        observation({
          currencyCode: "USD",
          costNanoMinor: 13_000_000_000,
          costNanoUsd: 13_000_000_000,
          observedAtMs: T0 + 86_400_000,
        }),
      );
      await drainOutbox();

      expect(sendRetractPulledUsage).toHaveBeenCalledTimes(1);
      const withdrawal = sendRetractPulledUsage.mock.calls[0]?.[0];
      // Addressed to the cell being LEFT, not the one being landed in. A
      // withdrawal carrying the new currency would empty the cell that holds
      // the correct figure and leave the superseded one standing, which is the
      // same double-count with the surviving version chosen at random.
      expect(withdrawal).toMatchObject({
        restatementKey: RESTATEMENT_KEY,
        currencyCode: "EUR",
        costNanoMinor: 0,
      });
      // Dated to the day it CORRECTS. The daily check re-derives a day from
      // the events falling inside it, so a withdrawal stamped with the day the
      // correction ARRIVED is never read by the day it was meant to fix.
      expect(withdrawal.occurredAtMs).toBe(OCCURRED_AT);
      // Ordered by the pull that superseded it, which is strictly later than
      // the version being withdrawn — the fold drops a withdrawal that is not.
      expect(withdrawal.observedAtMs).toBe(T0 + 86_400_000);
    });

    /**
     * The euro version is precisely the one the ledger has no dollar figure
     * for, so a detector that gave up where the ledger does would be blind to
     * its own headline case.
     */
    it("remembers a version it could not write a ledger row for", async () => {
      await observe(observation({ currencyCode: "EUR", costNanoUsd: null }));

      expect(insertPulledUsageRows).not.toHaveBeenCalled();
      const instance = await store.findByRef<PulledUsageLedgerState>({
        ref: {
          processName: PULLED_USAGE_LEDGER_PROCESS_NAME,
          projectId: GOV_PROJECT,
          processKey: RESTATEMENT_KEY,
        },
      });
      expect(instance?.state.filedCell).toMatchObject({ currencyCode: "EUR" });
    });
  });

  describe("given a charge whose reissue has already been withdrawn", () => {
    /** @scenario Pulling the corrected day again withdraws nothing */
    it("withdraws nothing when the corrected day is pulled again unchanged", async () => {
      await observe(observation({ currencyCode: "EUR", costNanoUsd: null }));
      await observe(
        observation({ currencyCode: "USD", observedAtMs: T0 + 86_400_000 }),
      );
      await drainOutbox();
      expect(sendRetractPulledUsage).toHaveBeenCalledTimes(1);

      // The same corrected day, pulled again. A later instant, because the
      // observation key includes it and an unchanged re-pull still appends.
      await observe(
        observation({ currencyCode: "USD", observedAtMs: T0 + 172_800_000 }),
      );
      await drainOutbox();

      // Asserted on the SEND rather than on a total, because a second
      // withdrawal would move no money — it would empty a cell already at
      // zero — while the day's revision markers climbed forever against a
      // correction that happened once.
      expect(sendRetractPulledUsage).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a charge already reissued once", () => {
    /** @scenario A charge reissued a second time is compared against where it sits now */
    it("withdraws the version it currently sits in, not the one it started in", async () => {
      await observe(observation({ currencyCode: "EUR", costNanoUsd: null }));
      await observe(
        observation({ currencyCode: "USD", observedAtMs: T0 + 86_400_000 }),
      );
      await observe(
        observation({
          currencyCode: "USD",
          rawActorId: "someone-else",
          observedAtMs: T0 + 172_800_000,
        }),
      );
      await drainOutbox();

      expect(sendRetractPulledUsage).toHaveBeenCalledTimes(2);
      const second = sendRetractPulledUsage.mock.calls[1]?.[0];
      // The MIDDLE version. Comparing against where the charge first landed
      // would withdraw the euro cell a second time — a cell the first
      // withdrawal already emptied — and leave the dollar version live on top
      // of the newest one.
      expect(second).toMatchObject({ currencyCode: "USD", rawActorId: "" });
    });
  });

  /**
   * Two models of one period landing on ONE process instance, which is what a
   * shared restatement key means. `restatementKeyFor` (pulledUsageRecord)
   * hashes the adapter's `dimensions`, so this models an adapter that omits
   * the model from its dimensions. Azure is not one: it pins `meterCategory`
   * and `model` into `dimensions` (azureCostManagement.ts), so two Azure
   * meters never share a key. Hence the neutral source label here rather than
   * the file's Azure one.
   */
  describe("given a period that holds more than one model", () => {
    const OMITS_MODEL_SOURCE = "example_cost_source";

    /** @scenario A reissue is recognised from the currency, the agent and the spender only */
    it("withdraws nothing when only the model differs", async () => {
      await observe(
        observation({ source: OMITS_MODEL_SOURCE, model: "example/meter-a" }),
      );
      await observe(
        observation({
          source: OMITS_MODEL_SOURCE,
          model: "example/meter-b",
          observedAtMs: T0 + 3_600_000,
        }),
      );
      await drainOutbox();

      // Withdrawing here would zero money that was really spent, which is
      // strictly worse than the double-count the detector exists to prevent.
      expect(sendRetractPulledUsage).not.toHaveBeenCalled();
      expect(insertPulledUsageRows).toHaveBeenCalledTimes(2);
    });

    it("still addresses the superseded model when the currency moves too", async () => {
      await observe(
        observation({ source: OMITS_MODEL_SOURCE, model: "example/meter-a" }),
      );
      await observe(
        observation({
          source: OMITS_MODEL_SOURCE,
          model: "example/meter-b",
          currencyCode: "EUR",
          costNanoUsd: null,
          observedAtMs: T0 + 3_600_000,
        }),
      );
      await drainOutbox();

      // The model is not a TRIGGER, but it is part of the cell's address. A
      // withdrawal carrying the new model would empty a cell that never held
      // this charge and leave the one that does untouched.
      expect(sendRetractPulledUsage).toHaveBeenCalledTimes(1);
      expect(sendRetractPulledUsage.mock.calls[0]?.[0]).toMatchObject({
        model: "example/meter-a",
        currencyCode: "USD",
      });
    });
  });

  describe("given the withdrawal switch is off for the organization", () => {
    it("detects the reissue but withdraws nothing", async () => {
      retractionEnabled.mockResolvedValue(false);

      await observe(observation({ currencyCode: "EUR", costNanoUsd: null }));
      await observe(
        observation({ currencyCode: "USD", observedAtMs: T0 + 86_400_000 }),
      );
      await drainOutbox();

      // Read at EMIT time and per organization. A gate resolved when the
      // process was registered would keep withdrawing for as long as the
      // process lived after somebody switched it off.
      expect(retractionEnabled).toHaveBeenCalledWith(ORG_ID);
      expect(sendRetractPulledUsage).not.toHaveBeenCalled();
    });
  });
});
