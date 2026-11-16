// @vitest-environment node
// @see modules/model-provider/specs/default-models-scope-model-options.feature

import type { EmptyScopeProvider } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { emptyProvidersCopy } from "../empty-scope-models-copy.ts";

function emptyProvider(overrides: Partial<EmptyScopeProvider>): EmptyScopeProvider {
  return { id: "mp_1", provider: "azure", name: "Azure OpenAI", isSystem: false, ...overrides };
}

describe("emptyProvidersCopy", () => {
  describe("given one Azure provider with no chat deployment", () => {
    it("names it in the singular and calls its entries deployments", () => {
      expect(emptyProvidersCopy({ providers: [emptyProvider({})], kind: "chat" })).toBe(
        "Azure OpenAI lists only the deployments you add, and has no chat deployment yet. " +
          "Add one to pick it here.",
      );
    });
  });

  describe("given two empty providers", () => {
    /** @scenario The note names every empty provider and calls a non-Azure provider's entries models */
    it("names both in the plural and calls a mixed set's entries models", () => {
      const providers = [
        emptyProvider({}),
        emptyProvider({ id: "mp_2", provider: "custom", name: "ACME Gateway" }),
      ];

      expect(emptyProvidersCopy({ providers, kind: "chat" })).toBe(
        "Azure OpenAI and ACME Gateway list only the models you add, and have no chat model yet. " +
          "Add one to pick it here.",
      );
    });

    it("joins three names with commas and a final and", () => {
      const providers = [
        emptyProvider({ id: "mp_1", name: "ACME East" }),
        emptyProvider({ id: "mp_2", name: "ACME West" }),
        emptyProvider({ id: "mp_3", name: "ACME North" }),
      ];

      expect(emptyProvidersCopy({ providers, kind: "embedding" })).toMatch(
        /^ACME East, ACME West and ACME North list only the deployments you add, and have no embedding deployment yet\./,
      );
    });
  });

  describe("given one provider other than Azure", () => {
    it("calls its entries models", () => {
      const providers = [emptyProvider({ provider: "custom", name: "ACME Gateway" })];

      expect(emptyProvidersCopy({ providers, kind: "embedding" })).toBe(
        "ACME Gateway lists only the models you add, and has no embedding model yet. " +
          "Add one to pick it here.",
      );
    });
  });
});
