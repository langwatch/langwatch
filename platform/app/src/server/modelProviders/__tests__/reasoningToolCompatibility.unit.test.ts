import { describe, expect, it } from "vitest";

import type { ModelEndpoint, ReasoningConfig } from "../llmModels.types";
import { MODEL_ENDPOINTS } from "../llmModels.types";
import { llmModels } from "../loadModelCatalog";
import {
  findUndeclaredReasoningModels,
  resolveReasoningToolCompatibility,
} from "../resolveSupportedParameters";

/**
 * The family that took production down: the provider rejects reasoning
 * combined with function tools on /v1/chat/completions, and the scenario
 * judge always sends tools.
 */
const GPT_56_MODELS = [
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-sol-pro",
  "openai/gpt-5.6-luna",
  "openai/gpt-5.6-luna-pro",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-terra-pro",
];

describe("resolveReasoningToolCompatibility", () => {
  describe("when the model declares the conflict on this endpoint", () => {
    /** @scenario a conflicting model sending tools has its reasoning turned off */
    it("asks the caller to disable reasoning", () => {
      for (const modelId of GPT_56_MODELS) {
        expect(
          resolveReasoningToolCompatibility({
            modelId,
            endpoint: "chat_completions",
          }),
        ).toEqual({
          action: "disable-reasoning",
          parameterName: "reasoning_effort",
          value: "none",
        });
      }
    });

    /** @scenario the conflict is scoped to the endpoint it was declared on */
    it("allows the same model on every other endpoint", () => {
      const others = MODEL_ENDPOINTS.filter(
        (endpoint) => endpoint !== "chat_completions",
      );
      for (const endpoint of others) {
        expect(
          resolveReasoningToolCompatibility({
            modelId: "openai/gpt-5.6-sol",
            endpoint,
          }),
        ).toEqual({ action: "allow" });
      }
    });
  });

  describe("when the model reasons but declares no conflict", () => {
    /** @scenario a reasoning model with no declared conflict keeps its reasoning */
    it("allows reasoning and tools together", () => {
      // Each of these reasons, lists tools, and would be downgraded by a
      // blanket "no reasoning when tools are present" rule.
      for (const modelId of [
        "openai/gpt-5.1",
        "openai/gpt-5.2",
        "openai/gpt-5",
        "gemini/gemini-3.6-flash",
        "anthropic/claude-opus-4-8-fast",
      ]) {
        expect(
          resolveReasoningToolCompatibility({
            modelId,
            endpoint: "chat_completions",
          }),
        ).toEqual({ action: "allow" });
      }
    });
  });

  describe("when the model is not in the registry", () => {
    it("allows the request rather than guessing", () => {
      expect(
        resolveReasoningToolCompatibility({
          modelId: "custom/Qwen/Qwen2.5-32B-Instruct",
          endpoint: "chat_completions",
        }),
      ).toEqual({ action: "allow" });
    });
  });

  describe("when a conflicting model cannot disable reasoning", () => {
    /** @scenario a model that cannot disable reasoning is passed through untouched */
    it("reports the conflict as irreconcilable rather than silently degrading", () => {
      // No registry entry is in this state today, so the case is built
      // rather than looked up. It is representable on purpose: the rule
      // has to have an answer for it before a model arrives in it.
      const registry = llmModels.models as Record<
        string,
        { reasoningConfig?: ReasoningConfig }
      >;
      const modelId = "openai/gpt-5.6-fixture-locked";
      registry[modelId] = {
        reasoningConfig: {
          supported: true,
          parameterName: "reasoning_effort",
          allowedValues: ["low", "medium", "high"],
          defaultValue: "medium",
          canDisable: false,
          toolsIncompatibleOn: ["chat_completions"],
        },
      };
      try {
        expect(
          resolveReasoningToolCompatibility({
            modelId,
            endpoint: "chat_completions",
          }),
        ).toEqual({
          action: "irreconcilable",
          parameterName: "reasoning_effort",
        });
      } finally {
        delete registry[modelId];
      }
    });
  });
});

describe("the model registry's reasoning capabilities", () => {
  const declared = Object.entries(llmModels.models).filter(
    ([, entry]) => entry.reasoningConfig,
  );

  const inconsistenciesIn = (
    id: string,
    entry: { reasoningConfig?: ReasoningConfig; supportedParameters: string[] },
  ): string[] => {
    const reasoning = entry.reasoningConfig!;
    const problems: string[] = [];
    if (!reasoning.allowedValues.includes(reasoning.defaultValue)) {
      problems.push(`${id}: defaultValue is not an allowed value`);
    }
    if (reasoning.canDisable !== reasoning.allowedValues.includes("none")) {
      problems.push(`${id}: canDisable disagrees with allowedValues`);
    }
    const conflicts = reasoning.toolsIncompatibleOn ?? [];
    const unknown = conflicts.filter(
      (endpoint) => !MODEL_ENDPOINTS.includes(endpoint as ModelEndpoint),
    );
    problems.push(...unknown.map((e) => `${id}: unknown endpoint ${e}`));
    const params = new Set(entry.supportedParameters);
    const supportsTools = params.has("tools") || params.has("tool_choice");
    if (conflicts.length > 0 && !supportsTools) {
      problems.push(
        `${id}: declares a tools conflict but does not support tools`,
      );
    }
    return problems;
  };

  /** @scenario every declared reasoning capability is internally consistent */
  it("keeps every declared capability internally consistent", () => {
    const inconsistent = declared.flatMap(([id, entry]) =>
      inconsistenciesIn(id, entry),
    );
    expect(inconsistent).toEqual([]);
  });

  /** @scenario the gpt-5.6 family is no longer undeclared */
  it("no longer leaves the gpt-5.6 family undeclared", () => {
    const undeclared = findUndeclaredReasoningModels();
    expect(undeclared.filter((id) => id.includes("gpt-5.6"))).toEqual([]);
  });

  /**
   * The registry is regenerated from an upstream catalogue that has no
   * notion of this constraint, so a new reasoning-class model arrives
   * asserting that reasoning and tools work together without anyone
   * having checked. That is exactly how the gpt-5.6 family shipped
   * broken. This is a baseline, not a clean bill of health: the listed
   * models are still undeclared and would need the same curation if we
   * started dispatching reasoning to them. Adding to it is a decision,
   * removing from it is progress.
   */
  /** @scenario a reasoning-class model claiming tools with no capability is caught */
  it("catches reasoning-class models that claim tools with no capability declared", () => {
    expect(findUndeclaredReasoningModels()).toEqual([
      "openai/gpt-5.4",
      "openai/gpt-5.4-mini",
      "openai/gpt-5.4-nano",
      "openai/gpt-5.4-pro",
      "openai/gpt-5.5",
      "openai/gpt-5.5-pro",
      "openai/o4-mini",
      "openai/o4-mini-deep-research",
      "openai/o4-mini-high",
    ]);
  });

  it("detects the condition rather than always reporting the same list", () => {
    // Proves the check can fail: drop a capability and its model comes
    // back into the report.
    const registry = llmModels.models as Record<
      string,
      { reasoningConfig?: ReasoningConfig }
    >;
    const entry = registry["openai/gpt-5.6-sol"]!;
    const saved = entry.reasoningConfig;
    delete entry.reasoningConfig;
    try {
      expect(findUndeclaredReasoningModels()).toContain("openai/gpt-5.6-sol");
    } finally {
      entry.reasoningConfig = saved;
    }
  });
});
