// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { JsonValue } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import {
  GOVERNANCE_ACTIVITY_MONITOR_PIPELINE_NAME,
  governanceActivityMonitorEventing,
} from "../governance-activity-monitor.pipeline.ts";
import { runGovernanceTraceFacts } from "../governance-trace-facts.intent.ts";
import {
  GOVERNANCE_TRACE_FACTS_FIRST_LOOKBACK_MS,
  GOVERNANCE_TRACE_FACTS_OVERLAP_MS,
  GOVERNANCE_TRACE_FACTS_PROCESS_NAME,
  governanceTraceFactsWake,
} from "../governance-trace-facts.process.ts";
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

describe("governance trace facts", () => {
  function wake(lastPassAt: number | null) {
    const pass = vi.fn((messageKey: string, payload: JsonValue) => ({
      messageKey,
      intentType: "pass",
      payload,
    }));
    const evolution = governanceTraceFactsWake(
      { lastPassAt },
      {
        at: AT,
        now: AT + 5_000,
        key: GOVERNANCE_TRACE_FACTS_PROCESS_NAME,
        projectId: "__global__",
        intent: intentAccessorOf({ pass }),
      },
    );
    return { pass, evolution };
  }

  /** @scenario "Governance pulls each minute's updated traces with an overlap behind the last pass" */
  it("reads from the overlap behind the last wake up to this wake's schedule time", () => {
    const { pass, evolution } = wake(AT - 60_000);
    expect(pass).toHaveBeenCalledWith(`pass:${AT}`, {
      fromMs: AT - 60_000 - GOVERNANCE_TRACE_FACTS_OVERLAP_MS,
      toMs: AT,
    });
    expect(evolution.state).toEqual({ lastPassAt: AT });
  });

  it("covers the hour before a first wake", () => {
    const { pass } = wake(null);
    expect(pass).toHaveBeenCalledWith(`pass:${AT}`, {
      fromMs: AT - GOVERNANCE_TRACE_FACTS_FIRST_LOOKBACK_MS - GOVERNANCE_TRACE_FACTS_OVERLAP_MS,
      toMs: AT,
    });
  });

  it("fails the pass when the pull fails, so the outbox re-drives the same window", async () => {
    const deleteDispatchedBefore = vi.fn(async () => 0);
    const run = runGovernanceTraceFacts({
      pull: () => Promise.reject(new Error("clickhouse unavailable")),
      deleteDispatchedBefore,
      now: () => AT,
    });
    await expect(run({ fromMs: 1, toMs: 2 })).rejects.toThrow("clickhouse unavailable");
    expect(deleteDispatchedBefore).not.toHaveBeenCalled();
  });

  it("pulls the payload's window and prunes its bookkeeping", async () => {
    const pull = vi.fn(async () => ({ written: 2 }));
    const deleteDispatchedBefore = vi.fn(async () => 0);
    await runGovernanceTraceFacts({ pull, deleteDispatchedBefore, now: () => AT })({
      fromMs: 1,
      toMs: 2,
    });
    expect(pull).toHaveBeenCalledWith({ fromMs: 1, toMs: 2 });
    expect(deleteDispatchedBefore).toHaveBeenCalledWith(
      expect.objectContaining({ processName: GOVERNANCE_TRACE_FACTS_PROCESS_NAME }),
    );
  });
});
