// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * When a disagreement between the summary and its events becomes drift.
 *
 * Not on sight. The fold and this check run on independent queues, so at the
 * moment of looking a summary that is seconds behind and a summary that is
 * wrong are the same picture, and the freshness watermark can only sometimes
 * tell them apart — it is a maximum, and two charges sharing one moment leave
 * it unmoved (`costRollupComparatorFreshness.unit.test.ts`). What CAN tell
 * them apart is time: a fold that is behind catches up, and drift does not. So
 * a disagreement spends a rung of the outbox ladder instead of raising an
 * alert, and only one still standing on the last rung is counted and logged.
 *
 * Driven through `buildIntentHandlers` — the same wiring the dispatcher calls
 * — rather than through a dispatcher, because the subject is what ONE delivery
 * does with its attempt number, and a real ladder would only add wall time to
 * the same four questions.
 *
 * Spec: specs/governance/cost-rollup-watch.feature
 * Decision: ADR-128.
 */

import type { PulledUsageProcessingEvent } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/events";
import { GOVERNANCE_COST_SOURCE } from "@ee/governance/projections/governanceCostRollup.constants";
import type {
  CostRollupCellMismatch,
  CostRollupComparison,
} from "@ee/governance/services/costRollupComparator.service";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildProcessManager } from "~/server/event-sourcing/pipeline/processBuilder";
import { buildIntentHandlers } from "~/server/event-sourcing/process-manager/processRuntime";

import {
  COST_ROLLUP_WATCH_MAX_ATTEMPTS,
  COST_ROLLUP_WATCH_PROCESS_NAME,
  CostRollupCheckUnsettledError,
  costRollupWatchPM,
} from "../costRollupWatch.process";

const TENANT = "proj_governance_home";
const DAY = "2026-08-23";

const incrementMismatch = vi.hoisted(() => vi.fn());
const errorLine = vi.hoisted(() => vi.fn());

vi.mock("~/server/metrics", () => ({
  incrementGovernanceCostRollupMismatch: incrementMismatch,
  setGovernanceCostRollupLagSeconds: vi.fn(),
}));

// Both the comparator's module and the process's own ask for a logger, and
// only one of them writes the drift line — so every logger this build hands
// out shares one spy, and the assertions read the message to tell them apart.
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createLogger: () => ({
    error: errorLine,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

/** One cell the two sides state different money for. */
const A_MISMATCH: CostRollupCellMismatch = {
  cell: {
    tenantId: TENANT,
    day: DAY,
    costSource: GOVERNANCE_COST_SOURCE.PULLED,
    ingestionSourceId: "src_1",
    provider: "copilot_studio_dataverse",
    model: "Azure Databricks",
    agentId: "",
    currencyCode: "USD",
    rawActorId: "",
  },
  summarizedNanoMinor: 1_000_000_000,
  derivedNanoMinor: 3_000_000_000,
};

/**
 * What the comparator saw. `behind` defaults to empty — the watermarks level —
 * because that is the case the ladder exists for: the reading that proves
 * nothing and would, taken at face value, publish a false alarm.
 */
function comparison({
  mismatches,
  behind = [],
}: {
  mismatches: CostRollupCellMismatch[];
  behind?: CostRollupComparison["behind"];
}): CostRollupComparison {
  return {
    day: DAY,
    costSource: GOVERNANCE_COST_SOURCE.PULLED,
    mismatches,
    lagMs: 0,
    behind,
  };
}

/** The `compareDay` intent handler, wired to a comparator the test controls. */
function handlerFor(compareDay: (params: unknown) => Promise<unknown>) {
  const { config } = buildProcessManager<PulledUsageProcessingEvent>({
    name: COST_ROLLUP_WATCH_PROCESS_NAME,
    applier: costRollupWatchPM({ comparator: { compareDay } as never }),
  });
  const handler = buildIntentHandlers(config).compareDay!;
  return (attempt: number) =>
    handler({
      message: {
        processName: COST_ROLLUP_WATCH_PROCESS_NAME,
        projectId: TENANT,
        processKey: `tenant:${TENANT}`,
        tenantId: TENANT,
        messageKey: `compare:${DAY}:1:0`,
        intentType: "compareDay",
        payload: {
          tenantId: TENANT,
          day: DAY,
          costSource: GOVERNANCE_COST_SOURCE.PULLED,
        },
        sourceEventId: null,
        attempt,
      },
    });
}

/** Drift lines only: the comparator's warn and info lines share this spy. */
function driftLines() {
  return errorLine.mock.calls.filter(([, message]) =>
    String(message).includes("disagrees with the events"),
  );
}

beforeEach(() => {
  incrementMismatch.mockClear();
  errorLine.mockClear();
});

describe("deciding whether a disagreement is drift", () => {
  describe("when the summary and its events disagree on an early look", () => {
    /** @scenario A disagreement found before the last look is looked at again */
    it("asks for the day again instead of counting it, even with the watermarks level", async () => {
      const deliver = handlerFor(async () =>
        comparison({ mismatches: [A_MISMATCH] }),
      );

      await expect(deliver(1)).rejects.toBeInstanceOf(
        CostRollupCheckUnsettledError,
      );
      expect(driftLines()).toHaveLength(0);
      expect(incrementMismatch).not.toHaveBeenCalled();
    });
  });

  describe("when the charge the summary is missing is older than the ones it has", () => {
    // A late arrival stamped BEFORE the newest charge already folded cannot
    // move the summary's watermark, so the summary reads as current — and the
    // fold is order-independent by design, so this is ordinary rather than
    // pathological.
    /** @scenario A disagreement over a charge older than the summary's newest is looked at again */
    it("asks for the day again rather than trusting a watermark that cannot have moved", async () => {
      const deliver = handlerFor(async () =>
        comparison({
          mismatches: [{ ...A_MISMATCH, derivedNanoMinor: 4_000_000_000 }],
        }),
      );

      await expect(deliver(2)).rejects.toBeInstanceOf(
        CostRollupCheckUnsettledError,
      );
      expect(driftLines()).toHaveLength(0);
    });
  });

  describe("when a disagreement is still there on the last look", () => {
    /** @scenario A disagreement that survives every look is counted and logged */
    it("counts it, names both figures, and completes rather than dying in the outbox", async () => {
      const deliver = handlerFor(async () =>
        comparison({ mismatches: [A_MISMATCH] }),
      );

      await expect(
        deliver(COST_ROLLUP_WATCH_MAX_ATTEMPTS),
      ).resolves.toBeUndefined();

      expect(incrementMismatch).toHaveBeenCalledTimes(1);
      expect(driftLines()).toHaveLength(1);
      expect(driftLines()[0]?.[0]).toMatchObject({
        tenantId: TENANT,
        day: DAY,
        summarized_nano_minor: 1_000_000_000,
        derived_nano_minor: 3_000_000_000,
      });
    });
  });

  describe("when a disagreement is gone by the time the day is asked for again", () => {
    /** @scenario A disagreement the summary settles between looks is never reported */
    it("completes quietly, so a fold that was merely behind is never named as drift", async () => {
      let look = 0;
      const deliver = handlerFor(async () => {
        look += 1;
        return comparison({ mismatches: look === 1 ? [A_MISMATCH] : [] });
      });

      await expect(deliver(1)).rejects.toBeInstanceOf(
        CostRollupCheckUnsettledError,
      );
      await expect(deliver(2)).resolves.toBeUndefined();

      expect(incrementMismatch).not.toHaveBeenCalled();
      expect(driftLines()).toHaveLength(0);
    });
  });
});
