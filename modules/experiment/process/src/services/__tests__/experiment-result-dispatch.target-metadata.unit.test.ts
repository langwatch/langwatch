import { describe, expect, it } from "vitest";

import { agentLoadKey, promptLoadKey } from "../../rules/experiment-execution-data.rules.ts";
import { ExperimentResultDispatchService } from "../experiment-result-dispatch.service.ts";

const dispatches = ExperimentResultDispatchService.create();
const buildTargetMetadata = dispatches.buildTargetMetadata.bind(dispatches);

/**
 * Which model gets RECORDED on the run — stored rather than read live, so edits to
 * evaluator config don't retroactively reattribute historical runs.
 * @see specs/experiments/comparison-leaderboard.feature
 * @see specs/experiments-v3/evaluation-execution.feature
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
  } as any)[0]!;

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
     * `localEvaluatorConfig` REPLACES the saved config wholesale, not
     * merged field by field, so a local config naming no model does not
     * fall back to the saved model — the evaluator's own default applies.
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
          promptLoadKey({
            promptId: "prompt-1",
            promptVersionNumber: 1,
          }),
          {
            name: "greeter",
            model: "openai/gpt-5-mini",
          } as any,
        ],
        [
          promptLoadKey({
            promptId: "prompt-1",
            promptVersionNumber: 2,
          }),
          {
            name: "greeter",
            model: "anthropic/claude-sonnet-5",
          } as any,
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
      } as any);

      expect(metadata[0]?.model).toBe("openai/gpt-5-mini");
      expect(metadata[0]?.promptVersion).toBe(1);
      expect(metadata[1]?.model).toBe("anthropic/claude-sonnet-5");
      expect(metadata[1]?.promptVersion).toBe(2);
    });
  });
});

describe("buildTargetMetadata — the versions a run records at start", () => {
  /** @see modules/experiment/specs/experiment-run-recorded-settings.feature */
  describe("given an agent target pinned to a deploy label", () => {
    /** @scenario "A run records the version an agent label resolved to when it started" */
    it("records the label and the version it resolved to", () => {
      const target = { id: "t1", type: "agent", dbAgentId: "agent-1", agentLabel: "production" };
      const [meta] = buildTargetMetadata({
        targets: [target] as any,
        loadedPrompts: new Map(),
        loadedAgents: new Map([
          [agentLoadKey(target), { id: "agent-1", name: "refund-bot", version: 3 } as any],
        ]),
      } as any);

      expect(meta).toMatchObject({
        name: "refund-bot",
        agentId: "agent-1",
        agentLabel: "production",
        agentVersion: 3,
      });
    });
  });

  describe("given an agent target with no deploy label", () => {
    /** @scenario "A target running the latest agent records no label" */
    it("records no label and no version", () => {
      const target = { id: "t1", type: "agent", dbAgentId: "agent-1" };
      const [meta] = buildTargetMetadata({
        targets: [target] as any,
        loadedPrompts: new Map(),
        loadedAgents: new Map([
          [agentLoadKey(target), { id: "agent-1", name: "refund-bot", version: 5 } as any],
        ]),
      } as any);

      expect(meta).not.toHaveProperty("agentLabel");
      expect(meta).not.toHaveProperty("agentVersion");
    });
  });

  describe("given a prompt target following the latest version", () => {
    /** @scenario "A prompt target following the latest records the version it loaded" */
    it("records the version the run loaded", () => {
      const target = { id: "t1", type: "prompt", promptId: "prompt-1" };
      const [meta] = buildTargetMetadata({
        targets: [target] as any,
        loadedPrompts: new Map([
          [
            promptLoadKey(target),
            { name: "greeter", model: "openai/gpt-5-mini", version: 4 } as any,
          ],
        ]),
        loadedAgents: new Map(),
      } as any);

      expect(meta?.promptVersion).toBe(4);
    });
  });
});
