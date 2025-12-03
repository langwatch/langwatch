import { describe, it } from "vitest";

describe("llmSchema", () => {
  describe("when maxTokens is undefined", () => {
    it.todo("accepts the value");
  });

  describe("when temperature is undefined", () => {
    it.todo("accepts the value");
  });
});

describe("refinedFormSchemaWithModelLimits", () => {
  describe("when maxTokens is undefined", () => {
    it.todo("passes validation");
  });

  describe("when maxTokens exceeds model limit", () => {
    it.todo("fails validation with appropriate message");
  });

  describe("when maxTokens is below MIN_MAX_TOKENS", () => {
    it.todo("fails validation with appropriate message");
  });

  describe("when maxTokens is within valid range", () => {
    it.todo("passes validation");
  });
});

