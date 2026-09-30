import { describe, expect, it } from "vitest";

import { ApiKeyGrantIdService } from "../api-key-grant-id.service.ts";

describe("ApiKeyGrantIdService", () => {
  describe("when an API-key grant needs a binding identifier", () => {
    /** @scenario "An API-key binding identifier is minted by the feature" */
    it("mints a rolebinding KSUID indistinguishable from a member's binding", () => {
      expect(ApiKeyGrantIdService.create().generateBindingId()).toMatch(/^rolebinding_/);
    });

    /** @scenario "An API-key binding identifier is minted by the feature" */
    it("mints a distinct identifier for every grant", () => {
      const adapter = ApiKeyGrantIdService.create();

      expect(adapter.generateBindingId()).not.toBe(adapter.generateBindingId());
    });
  });
});
