import { describe, expect, it } from "vitest";
import type { TargetConfig } from "@langwatch/experiment-contract";
import {
  getTargetMissingMappings,
  getUsedFields,
  targetHasMissingMappings,
} from "../mapping-validation";

describe("mappingValidation", () => {
  describe("prompt target validation", () => {
    const createPromptTargetConfig = (overrides: Partial<TargetConfig> = {}): TargetConfig =>
      ({
        id: "target-prompt-1",
        type: "prompt",
        promptId: "prompt-123",
        inputs: [
          { identifier: "input", type: "str" },
          { identifier: "product_name", type: "str" },
        ],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
        ...overrides,
      }) as TargetConfig;

    const draftWith = (messages: Array<{ role: "system" | "user"; content: string }>) => ({
      llm: { model: "gpt-5-mini" },
      messages,
      inputs: [
        { identifier: "input" as const, type: "str" as const },
        { identifier: "product_name" as const, type: "str" as const },
      ],
      outputs: [{ identifier: "output" as const, type: "str" as const }],
    });

    describe("given a draft whose template uses no variable at all", () => {
      /** @scenario "A prompt with no user or assistant message needs every declared variable" */
      it("requires every declared variable, since the engine folds them into the user turn", () => {
        const target = createPromptTargetConfig({
          localPromptConfig: draftWith([
            { role: "system", content: "Summarize what you are given." },
          ]),
        } as Partial<TargetConfig>);

        const result = getTargetMissingMappings(target, "dataset-1");

        expect(result.missingMappings.map((m) => m.fieldId).sort()).toEqual([
          "input",
          "product_name",
        ]);
        expect(result.missingMappings.every((m) => m.isRequired)).toBe(true);
        expect(result.isValid).toBe(false);
      });
    });

    describe("given no draft and no template lookup", () => {
      const target = createPromptTargetConfig();

      /** @scenario "A prompt target with no loaded template requires nothing" */
      it("requires nothing, so the header stays quiet and the run proceeds", () => {
        const result = getTargetMissingMappings(target, "dataset-1");

        expect(result.isValid).toBe(true);
        expect(result.missingMappings.every((m) => !m.isRequired)).toBe(true);
        expect(targetHasMissingMappings(target, "dataset-1")).toBe(false);
      });

      it("falls back to the declared variables for getUsedFields", () => {
        expect([...getUsedFields(target)].sort()).toEqual(["input", "product_name"]);
      });
    });
  });
});
