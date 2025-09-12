import { expect } from "vitest";
import { type Prompt } from "@/client-sdk/services/prompts/prompt";

export function toMatchPrompt(actual: any, expected: Prompt) {
  expect(actual.model).toBe(expected.model);
  expect(actual.temperature).toBe(expected.temperature);
  expect(actual.maxTokens).toBe(expected.maxTokens);
  expect(actual.messages).toEqual(expected.messages);
  expect(actual.prompt).toBe(expected.prompt);
  expect(actual.version).toBe(expected.version);
  expect(actual.versionId).toBe(expected.versionId);
}
