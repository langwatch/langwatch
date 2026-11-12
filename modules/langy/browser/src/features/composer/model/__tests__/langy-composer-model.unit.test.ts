import { describe, expect, it } from "vitest";

import { resolveComposerModel } from "../langy-composer-model.ts";

const reachable = ["anthropic/claude-sonnet-4-5", "gemini/gemini-3.7-flash"];

describe("given the composer has no model yet", () => {
  describe("when the resolved default names a provider nobody connected", () => {
    /** @scenario "A default naming a provider nobody connected never reaches the composer" */
    it("seeds the first model the project's providers serve", () => {
      expect(
        resolveComposerModel({
          current: "",
          resolvedDefault: "openai/gpt-5-mini",
          resolvedDefaultSettled: true,
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
          resolvedDefaultSettled: true,
          reachable,
        }),
      ).toBe("gemini/gemini-3.7-flash");
    });
  });

  describe("when no default resolves", () => {
    it("seeds the first model the project's providers serve", () => {
      expect(
        resolveComposerModel({
          current: "",
          resolvedDefault: null,
          resolvedDefaultSettled: true,
          reachable,
        }),
      ).toBe("anthropic/claude-sonnet-4-5");
    });
  });
});

describe("given the providers answered before the resolved default", () => {
  describe("when the default is still loading", () => {
    /** @scenario "The composer waits for the resolved default before seeding" */
    it("seeds nothing yet", () => {
      expect(
        resolveComposerModel({
          current: "",
          resolvedDefault: undefined,
          resolvedDefaultSettled: false,
          reachable,
        }),
      ).toBeNull();
    });
  });

  describe("when the default then answers", () => {
    /** @scenario "The composer waits for the resolved default before seeding" */
    it("seeds the default, not the first model in the menu", () => {
      expect(
        resolveComposerModel({
          current: "",
          resolvedDefault: "gemini/gemini-3.7-flash",
          resolvedDefaultSettled: true,
          reachable,
        }),
      ).toBe("gemini/gemini-3.7-flash");
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
          resolvedDefaultSettled: true,
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
          resolvedDefaultSettled: true,
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
          resolvedDefaultSettled: true,
          reachable: [],
        }),
      ).toBeNull();
      expect(
        resolveComposerModel({
          current: "openai/gpt-5-mini",
          resolvedDefault: null,
          resolvedDefaultSettled: true,
          reachable: [],
        }),
      ).toBeNull();
    });
  });
});
