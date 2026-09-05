import { describe, expect, it } from "vitest";

import { resolvePresenceAvailability } from "../presence-availability";

describe("resolvePresenceAvailability()", () => {
  describe("when the organization switch is off", () => {
    it("reports the organization as the level that disabled it, whatever the project says", () => {
      expect(
        resolvePresenceAvailability({
          organizationPresenceEnabled: false,
          projectPresenceEnabled: true,
        }),
      ).toEqual({ enabled: false, disabledAt: "organization" });
    });
  });

  describe("when only the project switch is off", () => {
    it("reports the project as the level that disabled it", () => {
      expect(resolvePresenceAvailability({ projectPresenceEnabled: false })).toEqual({
        enabled: false,
        disabledAt: "project",
      });
    });
  });

  describe("when neither switch has been read", () => {
    it("leaves presence enabled rather than guessing it off", () => {
      expect(resolvePresenceAvailability({})).toEqual({ enabled: true, disabledAt: null });
    });
  });
});
