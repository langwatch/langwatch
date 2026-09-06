/**
 * @see specs/experiments-v3/workbench-actions.feature
 */
import { describe, expect, it } from "vitest";
import { addTarget, removeTarget, setTargetPrompt, updateTargetModel } from "../transforms";
import { baseState, refusalCode } from "./workbench-fixtures";

describe("addTarget", () => {
  it("infers dataset mappings and evaluator mappings for the new target", () => {
    const { state, result } = addTarget({
      state: baseState(),
      payload: {
        type: "prompt",
        promptId: "prompt-2",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
      },
    });

    const added = state.targets[1]!;
    expect(added.id).toBe(result?.targetId);
    expect(added.mappings["ds-1"]!.input).toEqual({
      type: "source",
      source: "dataset",
      sourceId: "ds-1",
      sourceField: "input",
    });
    expect(state.evaluators[0]!.mappings["ds-1"]![added.id]!.output).toEqual({
      type: "source",
      source: "target",
      sourceId: added.id,
      sourceField: "output",
    });
  });

  it("keeps a mapping given on the payload", () => {
    const { state } = addTarget({
      state: baseState(),
      payload: {
        id: "target-b",
        type: "prompt",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [],
        mappings: {
          "ds-1": { input: { type: "value", value: "fixed" } },
        },
      },
    });

    expect(state.targets[1]!.mappings["ds-1"]!.input).toEqual({
      type: "value",
      value: "fixed",
    });
  });

  describe("when the payload names an id the workbench already holds", () => {
    /** @scenario "An id the workbench already holds is refused" */
    it("refuses with target_already_exists", () => {
      expect(
        refusalCode(() =>
          addTarget({
            state: baseState(),
            payload: {
              id: "target-a",
              type: "prompt",
              inputs: [],
              outputs: [],
              mappings: {},
            },
          }),
        ),
      ).toBe("target_already_exists");
    });

    /** @scenario "An id the workbench already holds is refused" */
    it("leaves the workbench with the one target it had", () => {
      const state = baseState();

      refusalCode(() =>
        addTarget({
          state,
          payload: {
            id: "target-a",
            type: "prompt",
            inputs: [],
            outputs: [],
            mappings: {},
          },
        }),
      );

      expect(state.targets.map((t) => t.id)).toEqual(["target-a"]);
    });
  });

  describe("when the payload names a blank id", () => {
    it("rejects it rather than adding a target no mapping can name", () => {
      expect(() =>
        addTarget({
          state: baseState(),
          payload: {
            id: "",
            type: "prompt",
            inputs: [],
            outputs: [],
            mappings: {},
          },
        }),
      ).toThrow();
    });
  });
});

describe("setTargetPrompt", () => {
  const localPromptConfig = {
    llm: { model: "openai/gpt-5-mini" },
    messages: [{ role: "user" as const, content: "Answer {{input}}" }],
    inputs: [{ identifier: "input", type: "str" as const }],
    outputs: [{ identifier: "output", type: "str" as const }],
  };

  it("writes the draft config and the variables that came with it", () => {
    const { state, result } = setTargetPrompt({
      state: baseState(),
      payload: {
        targetId: "target-a",
        localPromptConfig,
        inputs: [{ identifier: "input", type: "str" }],
      },
    });

    expect(result?.targetId).toBe("target-a");
    expect(state.targets[0]!.localPromptConfig).toEqual(localPromptConfig);
    expect(state.targets[0]!.inputs).toEqual([{ identifier: "input", type: "str" }]);
  });

  it("rejects a config the prompt schema does not accept", () => {
    expect(() =>
      setTargetPrompt({
        state: baseState(),
        payload: {
          targetId: "target-a",
          localPromptConfig: { llm: {} } as never,
        },
      }),
    ).toThrow();
  });

  it("refuses an unknown target", () => {
    expect(
      refusalCode(() =>
        setTargetPrompt({
          state: baseState(),
          payload: { targetId: "nope", localPromptConfig },
        }),
      ),
    ).toBe("target_not_found");
  });
});

describe("updateTargetModel", () => {
  it("switches the draft's model", () => {
    const state = baseState();
    state.targets[0]!.localPromptConfig = {
      llm: { model: "openai/gpt-5-mini", temperature: 0.2 },
      messages: [],
      inputs: [],
      outputs: [],
    };

    const { state: next, result } = updateTargetModel({
      state,
      payload: { targetId: "target-a", model: "anthropic/claude-opus-4" },
    });

    expect(next.targets[0]!.localPromptConfig?.llm).toEqual({
      model: "anthropic/claude-opus-4",
      temperature: 0.2,
    });
    expect(result?.model).toBe("anthropic/claude-opus-4");
  });

  describe("when the target has no draft config", () => {
    /** @scenario "Changing the model needs a prompt draft to change" */
    it("refuses with target_prompt_config_missing", () => {
      expect(
        refusalCode(() =>
          updateTargetModel({
            state: baseState(),
            payload: { targetId: "target-a", model: "openai/gpt-5-mini" },
          }),
        ),
      ).toBe("target_prompt_config_missing");
    });
  });
});

describe("removeTarget", () => {
  it("drops the column, its evaluator bucket and every reference to it", () => {
    const state = baseState();
    state.targets.push({
      id: "target-b",
      type: "prompt",
      inputs: [{ identifier: "context", type: "str" }],
      outputs: [],
      mappings: {
        "ds-1": {
          context: {
            type: "source",
            source: "target",
            sourceId: "target-a",
            sourceField: "output",
          },
        },
      },
    });
    state.evaluators.push({
      id: "evaluator_comparison",
      evaluatorType: "langevals/select_best_compare",
      inputs: [],
      mappings: {},
      comparison: {
        variants: ["target-a", "target-b"],
        hasGoldenAnswer: false,
        includeMetrics: [],
        randomizeOrder: true,
      },
    });

    const { state: next } = removeTarget({
      state,
      payload: { targetId: "target-a" },
    });

    expect(next.targets.map((t) => t.id)).toEqual(["target-b"]);
    expect(next.evaluators[0]!.mappings["ds-1"]!["target-a"]).toBeUndefined();
    expect(next.targets[0]!.mappings["ds-1"]!.context).toBeUndefined();
    expect(next.evaluators[1]!.comparison?.variants).toEqual(["target-b"]);
  });
});
