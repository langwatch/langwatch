import { describe, expect, it } from "vitest";

import { resolveComposerModel } from "../langyComposerModel";

const reachable = ["anthropic/claude-sonnet-4-5", "gemini/gemini-3.7-flash"];

describe("given the composer has no model yet", () => {
  describe("when the resolved default names a provider nobody connected", () => {
    /** @scenario "A default naming a provider nobody connected never reaches the composer" */
    it("seeds the first model the project's providers serve", () => {
      expect(
        resolveComposerModel({
          current: "",
          resolvedDefault: "openai/gpt-5-mini",
          reachable,
        }),
      ).toBe("anthropic/claude-sonnet-4-5");
    });
  });

  describe("when the resolved default is a model the project serves", () => {
    /** @scenario "A default naming a provider nobody connected never reaches the composer" */
    it("seeds that default unchanged", () => {
      expect(
        resolveComposerModel({
          current: "",
          resolvedDefault: "gemini/gemini-3.7-flash",
          reachable,
        }),
      ).toBe("gemini/gemini-3.7-flash");
    });
  });

  describe("when no default resolves", () => {
    it("seeds the first model the project's providers serve", () => {
      expect(
        resolveComposerModel({ current: "", resolvedDefault: null, reachable }),
      ).toBe("anthropic/claude-sonnet-4-5");
    });
  });
});

describe("given the composer already holds a model", () => {
  describe("when the project serves it", () => {
    it("leaves the pick alone", () => {
      expect(
        resolveComposerModel({
          current: "gemini/gemini-3.7-flash",
          resolvedDefault: "anthropic/claude-sonnet-4-5",
          reachable,
        }),
      ).toBeNull();
    });
  });

  describe("when the project cannot serve it", () => {
    it("snaps to a model the project serves", () => {
      expect(
        resolveComposerModel({
          current: "openai/gpt-5-mini",
          resolvedDefault: "openai/gpt-5-mini",
          reachable,
        }),
      ).toBe("anthropic/claude-sonnet-4-5");
    });
  });
});

describe("given the reachable list is empty", () => {
  describe("when the provider query has not answered yet", () => {
    it("changes nothing", () => {
      expect(
        resolveComposerModel({
          current: "",
          resolvedDefault: "openai/gpt-5-mini",
          reachable: [],
        }),
      ).toBeNull();
      expect(
        resolveComposerModel({
          current: "openai/gpt-5-mini",
          resolvedDefault: null,
          reachable: [],
        }),
      ).toBeNull();
    });
  });
});
