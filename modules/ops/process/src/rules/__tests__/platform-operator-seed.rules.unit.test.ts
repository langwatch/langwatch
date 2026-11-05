/**
 * @vitest-environment node
 * When the platform-operator seed may take an unverified named user: only with no email at all.
 */
import { describe, expect, it } from "vitest";

import { isEmailUnconfigured } from "../platform-operator-seed.rules.ts";

describe("isEmailUnconfigured", () => {
  describe("when no gateway is named and none is half-configured", () => {
    /** @scenario "An install with no email configured seeds the named user unverified" */
    it("answers true", () => {
      expect(isEmailUnconfigured({ mail: { provider: undefined, misconfigured: false } })).toBe(
        true,
      );
    });
  });

  describe("when a gateway is named but its settings are unusable", () => {
    /** @scenario "An install with no email configured seeds the named user unverified" */
    it("answers false, so the seed keeps waiting for a verified user", () => {
      expect(isEmailUnconfigured({ mail: { provider: undefined, misconfigured: true } })).toBe(
        false,
      );
    });
  });

  describe("when a gateway is configured", () => {
    /** @scenario "A set ADMIN_EMAILS waits for a named verified user and never falls back" */
    it("answers false", () => {
      expect(isEmailUnconfigured({ mail: { provider: "smtp", misconfigured: false } })).toBe(false);
    });
  });
});
