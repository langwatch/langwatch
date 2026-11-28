import { describe, expect, it } from "vitest";

import { resolveComposerModel, unservedDefaultModel } from "../langy-composer-model.ts";

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

  describe("when the first served provider lists an old generation first", () => {
    const bedrock = [
      "bedrock/us.anthropic.claude-sonnet-4-20250514-v1:0",
      "bedrock/us.amazon.nova-pro-v1:0",
      "bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1:0",
      "bedrock/us.anthropic.claude-opus-4-1-20250805-v1:0",
      "bedrock/global.anthropic.claude-opus-4-6-v1",
      "bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0",
      "gemini/gemini-3.7-flash",
    ];

    /** @scenario "A default naming a provider nobody connected never reaches the composer" */
    it("seeds that provider's newest model, not the first in its list", () => {
      expect(
        resolveComposerModel({
          current: "",
          resolvedDefault: "openai/gpt-6.1-terra",
          resolvedDefaultSettled: true,
          reachable: bedrock,
        }),
      ).toBe("bedrock/global.anthropic.claude-opus-4-6-v1");
    });

    it("snaps a model the project stopped serving to the same newest model", () => {
      expect(
        resolveComposerModel({
          current: "openai/gpt-6.1-terra",
          resolvedDefault: "openai/gpt-6.1-terra",
          resolvedDefaultSettled: true,
          reachable: bedrock,
        }),
      ).toBe("bedrock/global.anthropic.claude-opus-4-6-v1");
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

describe("given the composer seeded a model while the default was out of reach", () => {
  const seeded = {
    current: "anthropic/claude-sonnet-4-5",
    resolvedDefault: "gemini/gemini-3.7-flash",
    resolvedDefaultSettled: true,
    reachable,
  };

  describe("when the project then serves the default", () => {
    /** @scenario "A seed taken before the default was reachable gives way to the default" */
    it("moves the seed to the default", () => {
      expect(resolveComposerModel({ ...seeded, seedFollowsDefault: true })).toBe(
        "gemini/gemini-3.7-flash",
      );
    });

    /** @scenario "A seed taken before the default was reachable gives way to the default" */
    it("leaves a model the user picked, or the one a reopened conversation ran on, alone", () => {
      expect(resolveComposerModel({ ...seeded, seedFollowsDefault: false })).toBeNull();
    });
  });

  describe("when the seed falls out of the menu", () => {
    /** @scenario "A seed taken before the default was reachable gives way to the default" */
    it("moves to the default rather than the first model in the menu", () => {
      expect(
        resolveComposerModel({
          current: "openai/gpt-5-mini",
          resolvedDefault: "gemini/gemini-3.7-flash",
          resolvedDefaultSettled: true,
          reachable,
        }),
      ).toBe("gemini/gemini-3.7-flash");
    });
  });
});

describe("unservedDefaultModel", () => {
  /** @scenario "A default no provider serves is named, not swapped silently" */
  it("names the default once every model read answered and none serves it", () => {
    expect(
      unservedDefaultModel({ resolvedDefault: "openai/gpt-6.1-sol", settled: true, reachable }),
    ).toBe("openai/gpt-6.1-sol");
  });

  /** @scenario "A default no provider serves is named, not swapped silently" */
  it("says nothing while the reads load, when the default is served, or with no providers", () => {
    expect(
      unservedDefaultModel({ resolvedDefault: "openai/gpt-6.1-sol", settled: false, reachable }),
    ).toBeNull();
    expect(
      unservedDefaultModel({
        resolvedDefault: "gemini/gemini-3.7-flash",
        settled: true,
        reachable,
      }),
    ).toBeNull();
    expect(
      unservedDefaultModel({ resolvedDefault: "openai/gpt-6.1-sol", settled: true, reachable: [] }),
    ).toBeNull();
  });
});
