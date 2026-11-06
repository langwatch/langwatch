/**
 * The grant ceiling: a key or a binding never hands out more than its creator holds.
 * Spec: modules/authz/specs/permission-resolution.feature
 */
import { describe, expect, it } from "vitest";

import { findPermissionsBeyondHeld } from "../grant-escalation.rules.ts";

describe("given a caller holding organization:manage but not organization:delete", () => {
  describe("when they mint a key asking for organization:delete", () => {
    /** @scenario "Deleting the organization is never implied by managing it" */
    it("reports organization:delete as beyond what they hold", () => {
      expect(
        findPermissionsBeyondHeld({
          requested: ["organization:view", "organization:delete"],
          held: ["organization:view", "organization:manage", "team:manage"],
        }),
      ).toEqual(["organization:delete"]);
    });
  });

  describe("when they mint a key asking for other actions manage covers", () => {
    it("lets them through", () => {
      expect(
        findPermissionsBeyondHeld({
          requested: ["organization:view", "team:view", "team:update"],
          held: ["organization:manage", "team:manage"],
        }),
      ).toEqual([]);
    });
  });
});
