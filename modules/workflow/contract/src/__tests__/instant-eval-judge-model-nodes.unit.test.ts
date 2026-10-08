/**
 * Instant Evals answers evaluator judges only, so a graph naming it on a node that calls a model
 * is refused, naming the node.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import {
  INSTANT_EVAL_JUDGE_MODEL_ID,
  InstantEvalJudgeOnlyModelError,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import {
  assertNoInstantEvalJudgeModelNodes,
  instantEvalJudgeModelNodesOf,
} from "../instant-eval-judge-model-nodes.ts";

const graph = (nodes: unknown[]) => ({ name: "Triage", nodes, edges: [] });

const llmNode = ({ id, name, model }: { id: string; name?: string; model: string }) => ({
  id,
  type: "signature",
  data: {
    ...(name ? { name } : {}),
    parameters: [
      { identifier: "llm", type: "llm", value: { model } },
      { identifier: "instructions", type: "str", value: "Answer" },
    ],
  },
});

const draftNode = {
  id: "draft",
  type: "signature",
  data: {
    name: "Draft",
    localPromptConfig: {
      llm: { model: INSTANT_EVAL_JUDGE_MODEL_ID },
      messages: [],
      inputs: [],
      outputs: [],
    },
  },
};

const legacyNode = {
  id: "legacy",
  type: "signature",
  data: { name: "Legacy", llm: { model: INSTANT_EVAL_JUDGE_MODEL_ID } },
};

const judgeNode = {
  id: "judge",
  type: "evaluator",
  data: {
    name: "Judge",
    evaluator: "langevals/llm_boolean",
    parameters: [
      { identifier: "model", type: "str", value: INSTANT_EVAL_JUDGE_MODEL_ID },
      { identifier: "llm", type: "llm", value: { model: INSTANT_EVAL_JUDGE_MODEL_ID } },
    ],
    localConfig: { settings: { model: INSTANT_EVAL_JUDGE_MODEL_ID } },
  },
};

describe("instantEvalJudgeModelNodesOf()", () => {
  describe("when a node that calls a model names Instant Evals", () => {
    /** @scenario "A workflow or a workbench naming Instant Evals outside a judge is refused where it sits" */
    it("names each node, in any of its model slots, by its name or else its id", () => {
      const dsl = graph([
        llmNode({ id: "answer", name: "Answer", model: INSTANT_EVAL_JUDGE_MODEL_ID }),
        llmNode({ id: "unnamed", model: INSTANT_EVAL_JUDGE_MODEL_ID }),
        draftNode,
        legacyNode,
      ]);

      expect(instantEvalJudgeModelNodesOf({ dsl })).toEqual([
        'node "Answer"',
        'node "unnamed"',
        'node "Draft"',
        'node "Legacy"',
      ]);
    });

    it("shortens a long node name so the list stays readable", () => {
      const dsl = graph([
        llmNode({ id: "long", name: "A".repeat(80), model: INSTANT_EVAL_JUDGE_MODEL_ID }),
      ]);

      const [place] = instantEvalJudgeModelNodesOf({ dsl });

      expect(place?.length).toBeLessThanOrEqual(64);
      expect(place).toMatch(/^node "A+…"$/);
    });
  });

  describe("when Instant Evals sits only on an evaluator node", () => {
    /** @scenario "A workflow whose evaluator node judges on Instant Evals still saves, copies and pushes" */
    it("names nothing", () => {
      const dsl = graph([judgeNode, llmNode({ id: "answer", model: "openai/gpt-5-mini" })]);

      expect(instantEvalJudgeModelNodesOf({ dsl })).toEqual([]);
    });
  });

  describe("when the graph is not shaped as one", () => {
    it.each([undefined, null, "graph", { nodes: "none" }, { nodes: [null, 3, { data: 1 }] }])(
      "names nothing for %s",
      (dsl) => {
        expect(instantEvalJudgeModelNodesOf({ dsl })).toEqual([]);
      },
    );
  });
});

describe("assertNoInstantEvalJudgeModelNodes()", () => {
  /** @scenario "A workflow or a workbench naming Instant Evals outside a judge is refused where it sits" */
  it("refuses as a client error that names the nodes", () => {
    const dsl = graph([
      llmNode({ id: "answer", name: "Answer", model: INSTANT_EVAL_JUDGE_MODEL_ID }),
    ]);

    const refuse = () => assertNoInstantEvalJudgeModelNodes({ dsl });

    expect(refuse).toThrow(InstantEvalJudgeOnlyModelError);
    expect(refuse).toThrow(
      expect.objectContaining({
        httpStatus: 422,
        meta: expect.objectContaining({ places: ['node "Answer"'] }),
        message: expect.stringContaining('node "Answer"'),
      }),
    );
  });

  /** @scenario "A workflow whose evaluator node judges on Instant Evals still saves, copies and pushes" */
  it("lets a graph through whose only Instant Evals is an evaluator judge", () => {
    expect(() => assertNoInstantEvalJudgeModelNodes({ dsl: graph([judgeNode]) })).not.toThrow();
  });
});
