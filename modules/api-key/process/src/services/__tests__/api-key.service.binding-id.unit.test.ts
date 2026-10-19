import { newAuthzGrantId } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import type { ApiKeyGrantId } from "../api-key.service.ts";

const bindingIds: ApiKeyGrantId = { generateBindingId: newAuthzGrantId };

describe("ApiKeyGrantId", () => {
  describe("when an API-key grant needs a binding identifier", () => {
    /** @scenario "An API-key binding identifier is minted by the feature" */
    it("mints a rolebinding KSUID indistinguishable from a member's binding", () => {
      expect(bindingIds.generateBindingId()).toMatch(/^rolebinding_/);
    });

    /** @scenario "An API-key binding identifier is minted by the feature" */
    it("mints a distinct identifier for every grant", () => {
      expect(bindingIds.generateBindingId()).not.toBe(bindingIds.generateBindingId());
    });
  });
});
