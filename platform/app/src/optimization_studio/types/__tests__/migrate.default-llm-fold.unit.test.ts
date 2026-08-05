/**
 * @vitest-environment node
 *
 * @see specs/workflows/workflow-node-owned-llm.feature
 *
 * spec_version 1.4 → 1.5: the workflow-level default_llm is removed —
 * every LLM node owns its config. The migration folds the old default
 * into any llm parameter that has no model of its own and drops the
 * field, so legacy persisted versions keep running identically.
 */
import { describe, expect, it } from "vitest";

import type { LLMConfig, Workflow } from "../dsl";
import { migrateDSLVersion } from "../migrate";

const legacyWorkflow = (overrides: {
  default_llm?: Partial<LLMConfig>;
  llmParamValue?: unknown;
}): Workflow =>
  ({
    spec_version: "1.4",
    name: "Legacy",
    icon: "🧩",
    description: "",
    version: "1.0",
    ...(overrides.default_llm !== undefined
      ? { default_llm: overrides.default_llm }
      : {}),
    template_adapter: "default",
    enable_tracing: true,
    state: {},
    edges: [],
    nodes: [
      {
        id: "llm_call",
        type: "signature",
        position: { x: 0, y: 0 },
        data: {
          name: "LLM Call",
          parameters: [
            { identifier: "llm", type: "llm", value: overrides.llmParamValue },
            { identifier: "instructions", type: "str", value: "hi" },
          ],
        },
      },
    ],
  }) as unknown as Workflow;

const llmValueOf = (dsl: Workflow): LLMConfig | undefined =>
  dsl.nodes[0]!.data.parameters?.find((p) => p.type === "llm")?.value as
    | LLMConfig
    | undefined;

describe("migrateDSLVersion 1.4 → 1.5 (default_llm fold)", () => {
  /** @scenario spec_version 1.4 workflows fold default_llm into modelless LLM nodes */
  it("folds default_llm into an llm parameter with no value", () => {
    const migrated = migrateDSLVersion(
      legacyWorkflow({
        default_llm: { model: "openai/gpt-5-mini", max_tokens: 512 },
        llmParamValue: undefined,
      }),
    );

    expect(migrated.spec_version).toBe("1.5");
    expect(llmValueOf(migrated)).toEqual({
      model: "openai/gpt-5-mini",
      max_tokens: 512,
    });
    expect("default_llm" in migrated).toBe(false);
  });

  it("fills the model but keeps node-level params when only the model was missing", () => {
    const migrated = migrateDSLVersion(
      legacyWorkflow({
        default_llm: { model: "openai/gpt-5-mini", max_tokens: 512 },
        llmParamValue: { model: "", temperature: 0.3 },
      }),
    );

    expect(llmValueOf(migrated)).toEqual({
      model: "openai/gpt-5-mini",
      max_tokens: 512,
      temperature: 0.3,
    });
  });

  it("leaves a node-owned model untouched", () => {
    const migrated = migrateDSLVersion(
      legacyWorkflow({
        default_llm: { model: "openai/gpt-5-mini" },
        llmParamValue: { model: "anthropic/claude-haiku-4-5-20251001" },
      }),
    );

    expect(llmValueOf(migrated)).toEqual({
      model: "anthropic/claude-haiku-4-5-20251001",
    });
    expect("default_llm" in migrated).toBe(false);
  });

  /** @scenario A 1.4 workflow with an empty default_llm model migrates without inventing a model */
  it("drops an empty-model default_llm without inventing a node model", () => {
    // The pre-fix bug shape: creation persisted default_llm.model = "".
    const migrated = migrateDSLVersion(
      legacyWorkflow({
        default_llm: { model: "" },
        llmParamValue: undefined,
      }),
    );

    expect(migrated.spec_version).toBe("1.5");
    expect(llmValueOf(migrated)).toBeUndefined();
    expect("default_llm" in migrated).toBe(false);
  });

  it("migrates a 1.3 workflow through both steps to 1.5", () => {
    const legacy = legacyWorkflow({
      default_llm: { model: "openai/gpt-5-mini" },
      llmParamValue: undefined,
    }) as unknown as { spec_version: string; template_adapter?: string };
    legacy.spec_version = "1.3";
    delete legacy.template_adapter;

    const migrated = migrateDSLVersion(legacy as unknown as Workflow);

    expect(migrated.spec_version).toBe("1.5");
    expect(migrated.template_adapter).toBe("dspy_chat_adapter");
    expect(llmValueOf(migrated)?.model).toBe("openai/gpt-5-mini");
  });
});
