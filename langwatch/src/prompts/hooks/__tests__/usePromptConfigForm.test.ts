/* eslint-disable @typescript-eslint/no-empty-function */
import { describe, expect, it, vi } from "vitest";

import { salvageValidData } from "~/utils/zodSalvage";
import { formSchema } from "~/prompt-configs";
import { buildDefaultFormValues } from "~/prompts/utils/buildDefaultFormValues";

/**
 * Tests for usePromptConfigForm's data salvage logic.
 *
 * Note: We test the salvageValidData utility directly rather than rendering
 * the React hook, as the hook's primary responsibility is data parsing,
 * which is delegated to salvageValidData. This avoids needing jsdom/DOM env.
 */
describe("usePromptConfigForm", () => {
  describe("when initialConfigValues are valid", () => {
    it("parses and uses the provided values", () => {
      const defaults = buildDefaultFormValues();
      const initialValues = {
        handle: "test-handle",
        scope: "PROJECT" as const,
        version: {
          configData: {
            prompt: "Test prompt",
            inputs: [{ identifier: "input", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
          },
        },
      };

      const result = salvageValidData(formSchema, initialValues, defaults);

      expect(result.handle).toBe("test-handle");
      expect(result.version.configData.prompt).toBe("Test prompt");
    });
  });

  describe("when initialConfigValues are corrupted", () => {
    it("salvages valid parts and uses defaults for invalid parts", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const defaults = buildDefaultFormValues();
      const corruptedValues = {
        handle: "valid-handle", // This should be salvaged
        // Missing required field: scope
        version: {
          configData: {
            prompt: "Valid prompt text", // This should be salvaged
            inputs: [{ identifier: "", type: "str" }], // Empty identifier - invalid
            outputs: [{ identifier: "output", type: "str" }], // Valid - should be salvaged
          },
        },
      };

      const result = salvageValidData(formSchema, corruptedValues, defaults);

      // Should not crash
      expect(result.scope).toBeDefined();

      // Should salvage valid parts
      expect(result.handle).toBe("valid-handle");
      expect(result.version.configData.prompt).toBe("Valid prompt text");
      expect(result.version.configData.outputs).toHaveLength(1);
      expect(result.version.configData.outputs[0]?.identifier).toBe("output");

      // Should use defaults for invalid/missing parts
      expect(result.version.configData.llm).toBeDefined();
      expect(result.version.configData.inputs).toBeDefined();

      consoleWarnSpy.mockRestore();
    });
  });
});
