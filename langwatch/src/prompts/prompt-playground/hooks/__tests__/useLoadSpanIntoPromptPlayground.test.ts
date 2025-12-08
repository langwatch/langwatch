import { describe, it } from "vitest";

describe("useLoadSpanIntoPromptPlayground", () => {
  describe("createDefaultPromptFormValues", () => {
    describe("when model is missing", () => {
      it.todo("uses DEFAULT_MODEL when spanData.llmConfig.model is undefined");
    });

    describe("when systemPrompt handling", () => {
      it.todo("uses systemPrompt string when it is a string");
      it.todo("stringifies systemPrompt when it is an object");
      it.todo("uses empty string when systemPrompt is undefined");
    });
  });
});
