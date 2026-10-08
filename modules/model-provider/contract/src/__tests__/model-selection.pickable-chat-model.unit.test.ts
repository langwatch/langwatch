/**
 * Whether a project's providers offer a chat model the pickers would list: what a new
 * evaluator created through the API reads to decide it has no model to run.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { describe, expect, it } from "vitest";

import { hasPickableChatModel } from "../model-selection.ts";

const chatModel = { id: "my-chat", label: "My chat", type: "chat" as const };

describe("hasPickableChatModel", () => {
  it("finds none without a provider", () => {
    expect(hasPickableChatModel([])).toBe(false);
  });

  it("finds the registry models of an enabled provider", () => {
    expect(hasPickableChatModel([{ provider: "openai", enabled: true, customModels: [] }])).toBe(
      true,
    );
  });

  it("finds none on a disabled provider", () => {
    expect(hasPickableChatModel([{ provider: "openai", enabled: false, customModels: [] }])).toBe(
      false,
    );
  });

  it("finds an enabled provider's own chat model", () => {
    expect(
      hasPickableChatModel([{ provider: "custom", enabled: true, customModels: [chatModel] }]),
    ).toBe(true);
  });

  it("finds none on an enabled provider with no chat model to offer", () => {
    expect(hasPickableChatModel([{ provider: "custom", enabled: true, customModels: [] }])).toBe(
      false,
    );
  });

  it("finds none on a provider that serves only restricted features", () => {
    expect(
      hasPickableChatModel([{ provider: "openai_codex", enabled: true, customModels: [] }]),
    ).toBe(false);
  });
});
