import { describe, expect, it } from "vitest";

import { buildTargetMetadata } from "../orchestrator";

/**
 * Which model gets RECORDED on the run.
 *
 * Stored rather than read live, because an evaluator's config can be edited
 * afterwards and reading it at display time would retroactively reattribute
 * every historical run to whatever is configured today.
 *
 * That makes an unsaved local edit the interesting case: execution honours it
 * (`workflowBuilder` resolves `localEvaluatorConfig?.settings ?? dbConfig`), so
 * a recorder that ignored it would run on one model and record another — and
 * the recorded one is what feeds the leaderboard's self-preference check,
 * which would then report independence from a model that never judged.
 *
 * @see specs/experiments/comparison-leaderboard.feature
 */

const build = (target: Record<string, unknown>) =>
  buildTargetMetadata({
    targets: [target] as any,
    loadedPrompts: new Map(),
    loadedAgents: new Map(),
    loadedEvaluators: new Map([
      [
        "eval-1",
        {
          id: "eval-1",
          name: "Comparison",
          config: { settings: { model: "openai/gpt-5-mini" } },
        },
      ],
    ]),
    loadedWorkflows: new Map(),
  })[0]!;

describe("buildTargetMetadata — the judge model recorded on a run", () => {
  describe("given an evaluator target with no unsaved edits", () => {
    it("records the saved config's model", () => {
      const meta = build({
        id: "t1",
        type: "evaluator",
        targetEvaluatorId: "eval-1",
      });

      expect(meta.model).toBe("openai/gpt-5-mini");
    });
  });

  describe("given the judge model was switched without saving", () => {
    it("records what execution will actually run, not the saved config", () => {
      const meta = build({
        id: "t1",
        type: "evaluator",
        targetEvaluatorId: "eval-1",
        localEvaluatorConfig: {
          settings: { model: "anthropic/claude-sonnet-5" },
        },
      });

      expect(meta.model).toBe("anthropic/claude-sonnet-5");
    });
  });

  describe("given an unsaved edit whose settings name no model", () => {
    /**
     * Records nothing, and that is the correct answer rather than a gap.
     *
     * `workflowBuilder` resolves `localEvaluatorConfig?.settings ?? dbConfig
     * ?.settings ?? {}` — the local object REPLACES the saved one wholesale,
     * it is not merged field by field. So a local config naming no model does
     * not run on the saved model either; the evaluator's own default applies
     * downstream. Falling back to the saved model here would read as the more
     * helpful behaviour and would be a lie about what ran.
     *
     * This is pinned because "fall back per field" is the intuitive
     * expectation, and acting on it would silently break the one invariant
     * this function exists to hold: recorded is what executed.
     */
    it("records nothing, matching what execution resolves", () => {
      const meta = build({
        id: "t1",
        type: "evaluator",
        targetEvaluatorId: "eval-1",
        localEvaluatorConfig: { settings: { temperature: 0.7 } },
      });

      expect(meta.model).toBeNull();
    });
  });
});
