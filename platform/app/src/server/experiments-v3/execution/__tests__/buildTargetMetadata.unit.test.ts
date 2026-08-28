import { describe, expect, it } from "vitest";

import type { VersionedPrompt } from "@langwatch/prompt-contract";
import { promptLoadKey } from "../dataLoader";
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

  describe("given two columns pinned to different versions of one prompt", () => {
    /** @scenario "Two columns pinned to different versions of one prompt each run their own version" */
    it("records each column's own version, not whichever loaded last", () => {
      const loadedPrompts = new Map([
        [
          promptLoadKey({ promptId: "prompt-1", promptVersionNumber: 1 }),
          {
            name: "greeter",
            model: "openai/gpt-5-mini",
          } as unknown as VersionedPrompt,
        ],
        [
          promptLoadKey({ promptId: "prompt-1", promptVersionNumber: 2 }),
          {
            name: "greeter",
            model: "anthropic/claude-sonnet-5",
          } as unknown as VersionedPrompt,
        ],
      ]);

      const metadata = buildTargetMetadata({
        targets: [
          {
            id: "t1",
            type: "prompt",
            promptId: "prompt-1",
            promptVersionNumber: 1,
          },
          {
            id: "t2",
            type: "prompt",
            promptId: "prompt-1",
            promptVersionNumber: 2,
          },
        ] as any,
        loadedPrompts,
        loadedAgents: new Map(),
      });

      expect(metadata[0]?.model).toBe("openai/gpt-5-mini");
      expect(metadata[0]?.prompt_version).toBe(1);
      expect(metadata[1]?.model).toBe("anthropic/claude-sonnet-5");
      expect(metadata[1]?.prompt_version).toBe(2);
    });
  });
});
