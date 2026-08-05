import { describe, expect, it } from "vitest";

import type { ModelEndpoint, ReasoningConfig } from "../llmModels.types";
import { MODEL_ENDPOINTS } from "../llmModels.types";
import { llmModels } from "../loadModelCatalog";
import { findUndeclaredReasoningModels } from "../resolveSupportedParameters";

/**
 * The family that took production down: the provider rejects reasoning
 * combined with function tools on /v1/chat/completions, and the scenario
 * judge always sends tools.
 *
 * The rule that acts on this lives in Go
 * (services/nlpgo/adapters/litellm/reasoningcaps.go) and is tested there.
 * These tests cover the half TypeScript still owns: that the registry data
 * the Go table is generated FROM is coherent, and that a model arriving in
 * the original broken state gets noticed.
 */
const GPT_56_MODELS = [
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-sol-pro",
  "openai/gpt-5.6-luna",
  "openai/gpt-5.6-luna-pro",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-terra-pro",
];

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

  /**
   * The runtime only knows how to rewrite chat-completions bodies, so a
   * declaration naming another endpoint is refused by the generator
   * (tools/modelcapsgen/registry.go). Pin the registry to that narrower
   * set here too, otherwise such a declaration passes this file's
   * consistency check and fails the Go build instead, which is a worse
   * place to find out.
   */
  it("declares conflicts only on the endpoint the runtime can honour", () => {
    const honoured = new Set(["chat_completions"]);
    const unhonourable = declared.flatMap(([id, entry]) =>
      (entry.reasoningConfig?.toolsIncompatibleOn ?? [])
        .filter((endpoint) => !honoured.has(endpoint))
        .map((endpoint) => `${id}: ${endpoint}`),
    );
    expect(unhonourable).toEqual([]);
  });

  /** @scenario the gpt-5.6 family is no longer undeclared */
  it("no longer leaves the gpt-5.6 family undeclared", () => {
    const undeclared = findUndeclaredReasoningModels();
    expect(undeclared.filter((id) => id.includes("gpt-5.6"))).toEqual([]);
  });

  it("declares the whole gpt-5.6 family, not only the model seen failing", () => {
    for (const modelId of GPT_56_MODELS) {
      expect(
        llmModels.models[modelId]?.reasoningConfig?.toolsIncompatibleOn,
      ).toEqual(["chat_completions"]);
    }
  });

  /**
   * The registry is regenerated from an upstream catalogue that has no
   * notion of this constraint, so a new reasoning-class model arrives
   * asserting that reasoning and tools work together without anyone
   * having checked. That is exactly how the gpt-5.6 family shipped
   * broken. This is a baseline, not a clean bill of health: the listed
   * models remain undeclared and unverified, and would need the same
   * curation if we started dispatching reasoning to them. Adding to it is
   * a decision, removing from it is progress.
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
