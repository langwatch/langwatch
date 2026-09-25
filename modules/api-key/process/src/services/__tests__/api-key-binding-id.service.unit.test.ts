import { describe, expect, it } from "vitest";

import { ApiKeyBindingIdService } from "../api-key-binding-id.service.ts";

describe("ApiKeyBindingIdService", () => {
  describe("when an API-key grant needs a binding identifier", () => {
    /** @scenario "An API-key binding identifier is minted by the feature" */
    it("mints a rolebinding KSUID indistinguishable from a member's binding", () => {
      expect(ApiKeyBindingIdService.create().generateBindingId()).toMatch(/^rolebinding_/);
    });

    /** @scenario "An API-key binding identifier is minted by the feature" */
    it("mints a distinct identifier for every grant", () => {
      const adapter = ApiKeyBindingIdService.create();

      expect(adapter.generateBindingId()).not.toBe(adapter.generateBindingId());
    });
  });
});
