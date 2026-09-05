/**
 * The unified reasoning field: one `llm.reasoning` on the form, carried through
 * to the save payload without any of the provider-specific names it replaced.
 *
 * UX contract: specs/model-config/unified-reasoning-form.feature.
 */
import { describe, expect, it } from "vitest";
import { formValuesToTriggerSaveVersionParams } from "../../../behavior/prompts/llm-prompt-config-utils";
import { buildDefaultFormValues } from "../default-form-values";
import { formSchema } from "../prompt-form.schemas";

describe("formValuesToTriggerSaveVersionParams", () => {
  describe("when form values include reasoning", () => {
    /** @scenario "formValuesToTriggerSaveVersionParams includes reasoning" */
    it("propagates reasoning 'high' and omits legacy provider-specific fields", () => {
      const formValues = buildDefaultFormValues({
        version: { configData: { llm: { reasoning: "high" } } },
      });

      const result = formValuesToTriggerSaveVersionParams(formValues);

      expect(result.reasoning).toBe("high");
      expect(result).not.toHaveProperty("reasoningEffort");
      expect(result).not.toHaveProperty("thinkingLevel");
      expect(result).not.toHaveProperty("effort");
    });
  });

  describe("when form values omit reasoning", () => {
    /** @scenario "formValuesToTriggerSaveVersionParams handles undefined reasoning" */
    it("returns reasoning undefined and no legacy fields", () => {
      const formValues = buildDefaultFormValues();

      const result = formValuesToTriggerSaveVersionParams(formValues);

      expect(result.reasoning).toBeUndefined();
      expect(result).not.toHaveProperty("reasoningEffort");
    });
  });
});

describe("formSchema reasoning validation", () => {
  describe("when llm.reasoning is set to a valid value", () => {
    /** @scenario "Form schema accepts reasoning field with valid value" */
    it("accepts 'high'", () => {
      const values = buildDefaultFormValues({
        version: { configData: { llm: { reasoning: "high" } } },
      });
      expect(formSchema.safeParse(values).success).toBe(true);
    });

    /** @scenario Form schema accepts reasoning field with "low" value */
    it("accepts 'low'", () => {
      const values = buildDefaultFormValues({
        version: { configData: { llm: { reasoning: "low" } } },
      });
      expect(formSchema.safeParse(values).success).toBe(true);
    });

    /** @scenario Form schema accepts reasoning field with "medium" value */
    it("accepts 'medium'", () => {
      const values = buildDefaultFormValues({
        version: { configData: { llm: { reasoning: "medium" } } },
      });
      expect(formSchema.safeParse(values).success).toBe(true);
    });
  });

  describe("when llm.reasoning is not set", () => {
    /** @scenario "Form schema accepts undefined reasoning" */
    it("accepts undefined reasoning", () => {
      const values = buildDefaultFormValues();
      expect(formSchema.safeParse(values).success).toBe(true);
      expect(values.version.configData.llm.reasoning).toBeUndefined();
    });
  });
});
