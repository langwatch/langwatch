/**
 * Unit tests for the orchestrator's storage-dispatch helpers.
 *
 *   - the judge model recorded for an evaluator target, pinned from the run
 *     rather than read live off today's evaluator config
 *   - what a non-processed evaluation may carry into storage: no score, no
 *     label, no verdict, but the money it really spent
 *
 * @see specs/experiments/comparison.feature
 */
import { describe, expect, it } from "vitest";
import type { EvaluationsV3State } from "@langwatch/experiment-contract";
import type { VersionedPrompt } from "@langwatch/prompt-contract";
import type { TypedAgent } from "@langwatch/agent-contract";
import {
  buildEvaluatorResultDispatch,
  buildTargetMetadata,
} from "../experiment-run-orchestrator.service";

const emptyAgents = new Map<string, TypedAgent>();

describe("buildTargetMetadata given an evaluator target", () => {
  const evaluatorTarget = () =>
    [
      {
        id: "target-judge",
        type: "evaluator",
        targetEvaluatorId: "evaluator-1",
        mappings: {},
      },
    ] as unknown as EvaluationsV3State["targets"];

  // The leaderboard's self-preference check asks whether the judge shares
  // a model family with a candidate. Reading the evaluator's live config
  // at render time would answer that question about today's config rather
  // than the run's, so the judge model is pinned onto the run here.
  /** @scenario "The judge model is the one that actually ran" */
  it("records the judging model from the evaluator's settings", () => {
    const [target] = buildTargetMetadata({
      targets: evaluatorTarget(),
      loadedPrompts: new Map<string, VersionedPrompt>(),
      loadedAgents: emptyAgents,
      loadedEvaluators: new Map([
        [
          "evaluator-1",
          {
            id: "evaluator-1",
            name: "Comparison",
            config: { settings: { model: "anthropic/claude-sonnet-5" } },
          },
        ],
      ]),
    });

    expect(target?.model).toBe("anthropic/claude-sonnet-5");
    expect(target?.name).toBe("Comparison");
    expect(target?.evaluator_id).toBe("evaluator-1");
  });
});

describe("buildEvaluatorResultDispatch", () => {
  const base = {
    tenantId: "project-1",
    runId: "run-1",
    experimentId: "experiment-1",
    evaluatorName: "Comparison",
    occurredAt: 1234,
    event: {
      rowIndex: 4,
      targetId: "",
      evaluatorId: "langevals/select_best_compare",
      duration: 8200,
    },
  };

  describe("given a judge that spent money and then declined to score", () => {
    /** @scenario "An inconclusive row still reports what it cost" */
    it("records what the row cost, with no score to go with it", () => {
      const dispatch = buildEvaluatorResultDispatch({
        ...base,
        result: {
          status: "skipped",
          details: "Order-sensitive verdict: the two passes disagreed.",
          cost: { currency: "USD", amount: 0.0021 },
        },
      } as never);

      expect(dispatch.cost).toBe(0.0021);
      expect(dispatch.status).toBe("skipped");
      expect(dispatch.score).toBeNull();
      expect(dispatch.label).toBeNull();
      expect(dispatch.passed).toBeNull();
    });
  });

  describe("given a judge that declined without spending anything", () => {
    it("records no cost rather than a zero", () => {
      const dispatch = buildEvaluatorResultDispatch({
        ...base,
        result: {
          status: "skipped",
          details: "N-way compare needs at least 2 candidates with output",
        },
      } as never);

      expect(dispatch.cost).toBeNull();
    });
  });
});
