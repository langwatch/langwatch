import { describe, expect, it } from "vitest";
import { ApiKeyBindingIdAdapter } from "../api-key-binding-id.adapter";

describe("ApiKeyBindingIdAdapter", () => {
  describe("when an API-key grant needs a binding identifier", () => {
    /** @scenario "An API-key binding identifier is minted by the feature" */
    it("mints a rolebinding KSUID indistinguishable from a member's binding", () => {
      expect(ApiKeyBindingIdAdapter.create().generateBindingId()).toMatch(/^rolebinding_/);
    });

    /** @scenario "An API-key binding identifier is minted by the feature" */
    it("mints a distinct identifier for every grant", () => {
      const adapter = ApiKeyBindingIdAdapter.create();

      expect(adapter.generateBindingId()).not.toBe(adapter.generateBindingId());
    });
  });
});
