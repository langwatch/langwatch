/**
 * Which model a connection ping runs, and how a refused generation is read.
 * Spec: specs/model-providers/credential-validation.feature
 */
import { getModelsForProvider, type Model } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import {
  classifyPingRefusal,
  findPingModels,
  UNPINGABLE_CREDENTIALS,
} from "../provider-ping.rules.ts";

const chatModel = (id: string): Model => ({ id, label: id, type: "chat" });

const cheapestOpenAiChat = () =>
  getModelsForProvider("openai")
    .filter((model) => model.mode === "chat")
    .reduce((a, b) => (a.pricing.inputCostPerToken <= b.pricing.inputCostPerToken ? a : b));

describe("given a chat provider", () => {
  describe("when the model to ping is picked", () => {
    /** @scenario "A chat provider is proven by a generation, not by a listing" */
    it("takes the cheapest chat model the catalogue lists for it", () => {
      const [first] = findPingModels({ provider: "openai", customModels: [] });
      expect(`openai/${first}`).toBe(cheapestOpenAiChat().id);
    });

    it("matches the bare and the prefixed ids a row stores, once each", () => {
      const bare = cheapestOpenAiChat().id.split("/").slice(1).join("/");
      const row = (id: string) => ({ provider: "openai", customModels: [chatModel(id)] });
      expect(findPingModels(row(bare))).toEqual([bare]);
      expect(findPingModels(row(`openai/${bare}`))).toEqual([bare]);
    });

    it("falls to the row's own custom model when the catalogue knows none", () => {
      const row = { provider: "custom", customModels: [chatModel("my-model")] };
      expect(findPingModels(row)).toEqual(["my-model"]);
    });
  });
});

describe("given a provider with no chat model anywhere", () => {
  /** @scenario "A provider with no chat model to name reports as unchecked" */
  it("names no model to ping", () => {
    expect(findPingModels({ provider: "custom", customModels: [] })).toEqual([]);
  });
});

describe("given a refused generation", () => {
  /** @scenario "An account with no credit left is reported as out of credit" */
  it("reads a quota refusal as out of credit", () => {
    expect(classifyPingRefusal({ status: 429, body: "insufficient_quota" })).toBe("credit");
  });

  /** @scenario "A plan over its usage limit is reported as such" */
  it("reads a plan limit as a usage limit rather than a bad key", () => {
    expect(classifyPingRefusal({ status: 429, body: "usage_limit_reached" })).toBe("usage_limit");
  });

  it("reads a 401 as a refused key", () => {
    expect(classifyPingRefusal({ status: 401, body: "" })).toBe("auth");
  });

  it("attributes a refusal it cannot place to the provider", () => {
    expect(classifyPingRefusal({ status: 500, body: "boom" })).toBe("other");
  });
});

describe("given a credential the probe could not read", () => {
  /** @scenario "A row whose credential could not be read is not pinged" */
  it("names both outcomes the caller must stop at", () => {
    expect(UNPINGABLE_CREDENTIALS).toEqual(["no_credential", "credential_masked"]);
  });
});
