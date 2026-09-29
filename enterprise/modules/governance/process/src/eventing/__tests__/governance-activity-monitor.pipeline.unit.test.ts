// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { JsonValue } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import {
  GOVERNANCE_ACTIVITY_MONITOR_PIPELINE_NAME,
  governanceActivityMonitorEventing,
} from "../governance-activity-monitor.pipeline.ts";
import { runSpendSpikeEvaluation } from "../spend-spike-evaluation.intent.ts";
import {
  SPEND_SPIKE_EVALUATION_PROCESS_NAME,
  spendSpikeEvaluationWake,
} from "../spend-spike-evaluation.process.ts";

const AT = 1_700_000_000_000;

describe("spend spike evaluation", () => {
  describe("given the activity monitor eventing declaration", () => {
    it("names its own pipeline", () => {
      expect(governanceActivityMonitorEventing.pipeline).toBe(
        GOVERNANCE_ACTIVITY_MONITOR_PIPELINE_NAME,
      );
    });
  });

  /** @scenario "Spend spike rules are evaluated every five minutes" */
  it("asks for one pass on every wake", () => {
    const pass = vi.fn((messageKey: string, payload: JsonValue) => ({
      messageKey,
      intentType: "pass",
      payload,
    }));
    const evolution = spendSpikeEvaluationWake(
      { lastPassAt: AT - 300_000 },
      {
        at: AT,
        now: AT,
        key: SPEND_SPIKE_EVALUATION_PROCESS_NAME,
        projectId: "__global__",
        intent: intentAccessorOf({ pass }),
      },
    );
    expect(pass).toHaveBeenCalledWith(`pass:${AT}`, { scheduledFor: AT });
    expect(evolution.state).toEqual({ lastPassAt: AT });
  });

  describe("when the pass intent runs", () => {
    it("evaluates through the app and prunes its bookkeeping", async () => {
      const evaluate = vi.fn(async () => ({ rulesEvaluated: 1, alertsFired: 0, skipped: {} }));
      const deleteDispatchedBefore = vi.fn(async () => 0);
      await runSpendSpikeEvaluation({ evaluate, deleteDispatchedBefore, now: () => AT })();
      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(deleteDispatchedBefore).toHaveBeenCalledWith(
        expect.objectContaining({ processName: SPEND_SPIKE_EVALUATION_PROCESS_NAME }),
      );
    });

    /** @scenario "A failed spend spike pass is evaluated again at the next wake" */
    it("fails the pass when evaluation fails, so the next wake evaluates again", async () => {
      const deleteDispatchedBefore = vi.fn(async () => 0);
      await expect(
        runSpendSpikeEvaluation({
          evaluate: () => Promise.reject(new Error("clickhouse unavailable")),
          deleteDispatchedBefore,
          now: () => AT,
        })(),
      ).rejects.toThrow("clickhouse unavailable");
      expect(deleteDispatchedBefore).not.toHaveBeenCalled();
    });
  });
});
