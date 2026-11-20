/**
 * @vitest-environment node
 * When an install has no email at all, as sign-up and the platform-operator seed both read it.
 */
import { describe, expect, it } from "vitest";

import { isEmailUnconfigured } from "../notification.ts";

describe("isEmailUnconfigured", () => {
  describe("when no gateway is named and none is half-configured", () => {
    it("answers true", () => {
      expect(isEmailUnconfigured({ mail: { provider: undefined, misconfigured: false } })).toBe(
        true,
      );
    });
  });

  describe("when a gateway is named but its settings are unusable", () => {
    it("answers false: a broken gateway is not the same as none", () => {
      expect(isEmailUnconfigured({ mail: { provider: undefined, misconfigured: true } })).toBe(
        false,
      );
    });
  });

  describe("when a gateway is configured", () => {
    it("answers false", () => {
      expect(isEmailUnconfigured({ mail: { provider: "smtp", misconfigured: false } })).toBe(false);
    });
  });
});
