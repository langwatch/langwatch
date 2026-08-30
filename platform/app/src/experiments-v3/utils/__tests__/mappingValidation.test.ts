import { describe, expect, it } from "vitest";
import type { TargetConfig } from "../../types";
import {
  getFieldsUsedByPromptTemplate,
  getTargetMissingMappings,
  getUsedFields,
  targetHasMissingMappings,
} from "../mappingValidation";

describe("mappingValidation", () => {
  describe("given an HTTP agent target", () => {
    const createHttpAgentTargetConfig = (
      overrides: Partial<TargetConfig> = {},
    ): TargetConfig => ({
      id: "target-http-1",
      type: "agent",
      agentType: "http",
      inputs: [{ identifier: "messages", type: "chat_messages" }],
      outputs: [{ identifier: "output", type: "str" }],
      mappings: {},
      httpConfig: {
        url: "https://api.example.com/chat",
        method: "POST",
        bodyTemplate:
          '{"messages": {{messages}}, "input": "{{input}}", "threadId": "{{threadId}}"}',
        outputPath: "$.result",
      },
      ...overrides,
    });

    describe("when a template variable is mapped but target.inputs is stale", () => {
      it("returns valid", () => {
        const target = createHttpAgentTargetConfig({
          mappings: {
            "dataset-1": {
              input: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-1",
                sourceField: "question",
              },
            },
          },
        });

        const result = getTargetMissingMappings(target, "dataset-1");

        expect(result.isValid).toBe(true);
      });
    });

    describe("when no variable is mapped", () => {
      it("returns invalid", () => {
        const target = createHttpAgentTargetConfig();

        const result = getTargetMissingMappings(target, "dataset-1");

        expect(result.isValid).toBe(false);
      });
    });

    describe("when body template has custom variables", () => {
      it("validates against template variables, not the default three", () => {
        const target = createHttpAgentTargetConfig({
          inputs: [],
          httpConfig: {
            url: "https://api.example.com/chat",
            method: "POST",
            bodyTemplate:
              '{"query": "{{user_query}}", "context": "{{context}}"}',
          },
        });

        // No mapping yet → invalid
        expect(getTargetMissingMappings(target, "dataset-1").isValid).toBe(
          false,
        );

        // Map one of the custom variables → valid
        const targetWithMapping = createHttpAgentTargetConfig({
          inputs: [],
          httpConfig: {
            url: "https://api.example.com/chat",
            method: "POST",
            bodyTemplate:
              '{"query": "{{user_query}}", "context": "{{context}}"}',
          },
          mappings: {
            "dataset-1": {
              user_query: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-1",
                sourceField: "question",
              },
            },
          },
        });

        const result = getTargetMissingMappings(targetWithMapping, "dataset-1");
        expect(result.isValid).toBe(true);
        expect(result.missingMappings).toHaveLength(1);
        expect(result.missingMappings[0]?.fieldId).toBe("context");
        expect(result.missingMappings[0]?.isRequired).toBe(false);
      });
    });

    describe("when body template has no variables", () => {
      it("returns valid with zero fields to map", () => {
        const target = createHttpAgentTargetConfig({
          inputs: [],
          httpConfig: {
            url: "https://api.example.com/chat",
            method: "POST",
            bodyTemplate: '{"static": "payload"}',
          },
        });

        // No variables at all → valid (nothing to map)
        expect(getTargetMissingMappings(target, "dataset-1").isValid).toBe(
          true,
        );
      });
    });
  });

  describe("evaluator target validation", () => {
    // Evaluator with:
    //   required fields: ["output", "expected_output"]
    //   optional fields: ["input"]
    const createEvaluatorTargetConfig = (
      overrides: Partial<TargetConfig> = {},
    ): TargetConfig => ({
      id: "target-eval-1",
      type: "evaluator",
      targetEvaluatorId: "eval-db-123",
      inputs: [
        { identifier: "output", type: "str" },
        { identifier: "expected_output", type: "str" },
        { identifier: "input", type: "str", optional: true },
      ],
      outputs: [
        { identifier: "passed", type: "bool" },
        { identifier: "score", type: "float" },
        { identifier: "label", type: "str" },
      ],
      mappings: {},
      ...overrides,
    });

    it("returns valid when all required fields are mapped", () => {
      const target = createEvaluatorTargetConfig({
        mappings: {
          "dataset-1": {
            output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "response",
            },
            expected_output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "expected",
            },
          },
        },
      });

      const result = getTargetMissingMappings(target, "dataset-1");

      expect(result.isValid).toBe(true);
      expect(result.missingMappings).toHaveLength(0);
    });

    it("returns invalid when required field is not mapped", () => {
      const target = createEvaluatorTargetConfig({
        mappings: {
          "dataset-1": {
            // Only map 'output', missing 'expected_output'
            output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "response",
            },
          },
        },
      });

      const result = getTargetMissingMappings(target, "dataset-1");

      expect(result.isValid).toBe(false);
      expect(result.missingMappings).toHaveLength(1);
      expect(result.missingMappings[0]?.fieldId).toBe("expected_output");
      expect(result.missingMappings[0]?.isRequired).toBe(true);
    });

    it("returns invalid when only optional field is mapped", () => {
      const target = createEvaluatorTargetConfig({
        mappings: {
          "dataset-1": {
            // Only optional field mapped, both required fields missing
            input: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "question",
            },
          },
        },
      });

      const result = getTargetMissingMappings(target, "dataset-1");

      expect(result.isValid).toBe(false);
      // Should have both required fields missing
      expect(result.missingMappings).toHaveLength(2);
      expect(result.missingMappings.some((m) => m.fieldId === "output")).toBe(
        true,
      );
      expect(
        result.missingMappings.some((m) => m.fieldId === "expected_output"),
      ).toBe(true);
    });

    it("returns valid when only optional fields are unmapped", () => {
      const target = createEvaluatorTargetConfig({
        mappings: {
          "dataset-1": {
            // Only required fields mapped
            output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "response",
            },
            expected_output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "expected",
            },
            // 'input' is optional - not mapped
          },
        },
      });

      const result = getTargetMissingMappings(target, "dataset-1");

      expect(result.isValid).toBe(true);
      // Should not list optional fields as missing
      expect(result.missingMappings).toHaveLength(0);
    });

    it("returns invalid when no fields are mapped at all", () => {
      const target = createEvaluatorTargetConfig({
        mappings: {},
      });

      const result = getTargetMissingMappings(target, "dataset-1");

      expect(result.isValid).toBe(false);
      // Should list both required fields as missing
      expect(result.missingMappings.some((m) => m.fieldId === "output")).toBe(
        true,
      );
      expect(
        result.missingMappings.some((m) => m.fieldId === "expected_output"),
      ).toBe(true);
    });

    it("targetHasMissingMappings returns true for invalid target", () => {
      const target = createEvaluatorTargetConfig({
        mappings: {},
      });

      expect(targetHasMissingMappings(target, "dataset-1")).toBe(true);
    });

    it("targetHasMissingMappings returns false for valid target", () => {
      const target = createEvaluatorTargetConfig({
        mappings: {
          "dataset-1": {
            output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "response",
            },
            expected_output: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "expected",
            },
          },
        },
      });

      expect(targetHasMissingMappings(target, "dataset-1")).toBe(false);
    });

    it("handles evaluator type with no required fields (all optional)", () => {
      // All fields are optional
      const target: TargetConfig = {
        id: "target-eval-2",
        type: "evaluator",
        targetEvaluatorId: "eval-db-456",
        inputs: [
          { identifier: "input", type: "str", optional: true },
          { identifier: "output", type: "str", optional: true },
          { identifier: "contexts", type: "str", optional: true },
        ],
        outputs: [
          { identifier: "passed", type: "bool" },
          { identifier: "score", type: "float" },
          { identifier: "label", type: "str" },
        ],
        mappings: {
          "dataset-1": {
            // Map at least one field (required for validity)
            input: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "question",
            },
          },
        },
      };

      const result = getTargetMissingMappings(target, "dataset-1");

      // Valid because there are no required fields and at least one optional is mapped
      expect(result.isValid).toBe(true);
    });

    it("returns invalid when evaluator type has no required fields but nothing is mapped", () => {
      // All fields are optional
      const target: TargetConfig = {
        id: "target-eval-2",
        type: "evaluator",
        targetEvaluatorId: "eval-db-456",
        inputs: [
          { identifier: "input", type: "str", optional: true },
          { identifier: "output", type: "str", optional: true },
          { identifier: "contexts", type: "str", optional: true },
        ],
        outputs: [
          { identifier: "passed", type: "bool" },
          { identifier: "score", type: "float" },
          { identifier: "label", type: "str" },
        ],
        mappings: {},
      };

      const result = getTargetMissingMappings(target, "dataset-1");

      // Invalid because at least one field must be mapped
      expect(result.isValid).toBe(false);
    });
  });

  describe("pairwise column-target validation (#5378)", () => {
    const createPairwiseTargetConfig = (
      overrides: Partial<TargetConfig> = {},
    ): TargetConfig => ({
      id: "target-pairwise-1",
      type: "evaluator",
      targetEvaluatorId: "eval-db-pairwise",
      inputs: [],
      outputs: [
        { identifier: "score", type: "float" },
        { identifier: "label", type: "str" },
      ],
      mappings: {},
      pairwise: {
        variantA: "target-a",
        variantB: "target-b",
        hasGoldenAnswer: true,
        goldenField: "expected_output",
        includeMetrics: [],
      },
      ...overrides,
    });

    describe("given hasGoldenAnswer is true", () => {
      describe("when goldenField is set", () => {
        it("returns valid with no missing mappings", () => {
          const target = createPairwiseTargetConfig();

          const result = getTargetMissingMappings(target, "dataset-1");

          expect(result.isValid).toBe(true);
          expect(result.missingMappings).toHaveLength(0);
        });
      });

      describe("when goldenField is unset", () => {
        it("returns invalid with a goldenField entry", () => {
          const target = createPairwiseTargetConfig({
            pairwise: {
              variantA: "target-a",
              variantB: "target-b",
              hasGoldenAnswer: true,
              goldenField: "",
              includeMetrics: [],
            },
          });

          const result = getTargetMissingMappings(target, "dataset-1");

          expect(result.isValid).toBe(false);
          expect(
            result.missingMappings.some((m) => m.fieldId === "goldenField"),
          ).toBe(true);
        });
      });
    });

    describe("given hasGoldenAnswer is false", () => {
      describe("when goldenField is unset", () => {
        it("returns valid without requiring goldenField", () => {
          const target = createPairwiseTargetConfig({
            pairwise: {
              variantA: "target-a",
              variantB: "target-b",
              hasGoldenAnswer: false,
              goldenField: "",
              includeMetrics: [],
            },
          });

          const result = getTargetMissingMappings(target, "dataset-1");

          expect(result.isValid).toBe(true);
          expect(
            result.missingMappings.some((m) => m.fieldId === "goldenField"),
          ).toBe(false);
        });
      });

      describe("when variantA/variantB are unset", () => {
        // The merge collapsed the two slot fields into one `variants` list, so
        // an under-filled comparison reports a single missing field however
        // many variants it wanted.
        it("still requires at least two variants", () => {
          const target = createPairwiseTargetConfig({
            pairwise: {
              variantA: "",
              variantB: "",
              hasGoldenAnswer: false,
              goldenField: "",
              includeMetrics: [],
            },
          });

          const result = getTargetMissingMappings(target, "dataset-1");

          expect(result.isValid).toBe(false);
          expect(
            result.missingMappings.some((m) => m.fieldId === "variants"),
          ).toBe(true);
        });
      });
    });
  });

  describe("getFieldsUsedByPromptTemplate", () => {
    describe("given a template with a user turn", () => {
      it("collects the variables of every message, the system one included", () => {
        const fields = getFieldsUsedByPromptTemplate({
          messages: [
            { role: "system", content: "Rank against {{brand_tier}}" },
            { role: "user", content: "Classify {{product_name}}" },
          ],
          declaredFieldIds: ["brand_tier", "product_name", "input"],
        });

        expect([...fields].sort()).toEqual(["brand_tier", "product_name"]);
      });

      it("leaves out a declared variable no message references", () => {
        const fields = getFieldsUsedByPromptTemplate({
          messages: [{ role: "user", content: "Classify {{product_name}}" }],
          declaredFieldIds: ["product_name", "input"],
        });

        expect(fields.has("input")).toBe(false);
      });
    });

    describe("given a template with no user or assistant message", () => {
      it("consumes every declared variable", () => {
        const fields = getFieldsUsedByPromptTemplate({
          messages: [{ role: "system", content: "You are a classifier." }],
          declaredFieldIds: ["input", "product_name"],
        });

        expect([...fields].sort()).toEqual(["input", "product_name"]);
      });

      it("consumes every declared variable for an empty template", () => {
        const fields = getFieldsUsedByPromptTemplate({
          messages: [],
          declaredFieldIds: ["input"],
        });

        expect(fields.has("input")).toBe(true);
      });
    });
  });

  describe("prompt target validation", () => {
    const createPromptTargetConfig = (
      overrides: Partial<TargetConfig> = {},
    ): TargetConfig => ({
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
    });

    const draftWith = (
      messages: Array<{ role: "system" | "user"; content: string }>,
    ) => ({
      llm: { model: "gpt-5-mini" },
      messages,
      inputs: [
        { identifier: "input" as const, type: "str" as const },
        { identifier: "product_name" as const, type: "str" as const },
      ],
      outputs: [{ identifier: "output" as const, type: "str" as const }],
    });

    describe("given a draft whose template skips a declared variable", () => {
      const target = createPromptTargetConfig({
        localPromptConfig: draftWith([
          { role: "system", content: "You classify products." },
          { role: "user", content: "Classify {{product_name}}" },
        ]),
      });

      /** @scenario "A declared input the template does not use needs no mapping" */
      it("does not report the unused variable at all", () => {
        const result = getTargetMissingMappings(target, "dataset-1");

        expect(result.missingMappings.some((m) => m.fieldId === "input")).toBe(
          false,
        );
      });

      /** @scenario "A declared prompt variable that IS referenced still requires a mapping" */
      it("requires the referenced variable", () => {
        const result = getTargetMissingMappings(target, "dataset-1");

        expect(
          result.missingMappings.find((m) => m.fieldId === "product_name")
            ?.isRequired,
        ).toBe(true);
        expect(result.isValid).toBe(false);
        expect(targetHasMissingMappings(target, "dataset-1")).toBe(true);
      });
    });

    describe("given a draft whose template uses no variable at all", () => {
      /** @scenario "A prompt with no user or assistant message needs every declared variable" */
      it("requires every declared variable, since the engine folds them into the user turn", () => {
        const target = createPromptTargetConfig({
          localPromptConfig: draftWith([
            { role: "system", content: "Summarize what you are given." },
          ]),
        });

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
        expect([...getUsedFields(target)].sort()).toEqual([
          "input",
          "product_name",
        ]);
      });
    });

    describe("given no draft and a template lookup", () => {
      const promptTemplateFields = () => new Set(["product_name"]);

      it("requires only what the template consumes", () => {
        const target = createPromptTargetConfig();

        const result = getTargetMissingMappings(target, "dataset-1", {
          promptTemplateFields,
        });

        expect(result.missingMappings.map((m) => m.fieldId)).toEqual([
          "product_name",
        ]);
        expect(result.missingMappings[0]?.isRequired).toBe(true);
        expect(
          targetHasMissingMappings(target, "dataset-1", {
            promptTemplateFields,
          }),
        ).toBe(true);
      });

      it("reports nothing once that variable is mapped", () => {
        const target = createPromptTargetConfig({
          mappings: {
            "dataset-1": {
              product_name: {
                type: "source",
                source: "dataset",
                sourceId: "dataset-1",
                sourceField: "name",
              },
            },
          },
        });

        const result = getTargetMissingMappings(target, "dataset-1", {
          promptTemplateFields,
        });

        expect(result.isValid).toBe(true);
        expect(result.missingMappings).toHaveLength(0);
      });

      it("keeps the draft as the source of truth when there is one", () => {
        const target = createPromptTargetConfig({
          localPromptConfig: draftWith([
            { role: "user", content: "Answer {{input}}" },
          ]),
        });

        const result = getTargetMissingMappings(target, "dataset-1", {
          promptTemplateFields,
        });

        expect(result.missingMappings.map((m) => m.fieldId)).toEqual(["input"]);
      });

      it("requires nothing when the lookup cannot resolve the template", () => {
        const target = createPromptTargetConfig();

        const result = getTargetMissingMappings(target, "dataset-1", {
          promptTemplateFields: () => undefined,
        });

        expect(result.isValid).toBe(true);
        expect(result.missingMappings.every((m) => !m.isRequired)).toBe(true);
      });
    });
  });
});
