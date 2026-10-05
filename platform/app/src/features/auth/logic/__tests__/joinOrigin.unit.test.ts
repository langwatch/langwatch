import { describe, expect, it } from "vitest";
import { joinOriginOf } from "../joinOrigin";

/**
 * Where a request made from the welcome screen is coming from, read off the
 * continuation the device page gave it (ADR-143 v6).
 *
 * Spec: specs/members/developer-seat.feature
 */
describe("joinOriginOf()", () => {
  describe("when the welcome screen was reached from the device-approval page", () => {
    /** @scenario A request made from the terminal lands as a Developer when approved */
    it("is the terminal", () => {
      expect(joinOriginOf({ returnTo: "/cli/auth?user_code=ABCD-EFGH" })).toBe(
        "cli",
      );
      expect(joinOriginOf({ returnTo: "/cli/auth" })).toBe("cli");
    });
  });

  describe("when there is no continuation, or another one", () => {
    /** @scenario A request made on the web keeps the organisation's joiner seat */
    it("is the web", () => {
      expect(joinOriginOf({ returnTo: null })).toBe("web");
      expect(joinOriginOf({ returnTo: undefined })).toBe("web");
      expect(joinOriginOf({ returnTo: "/settings" })).toBe("web");
      // A lookalike is not the device page.
      expect(joinOriginOf({ returnTo: "/cli/authx" })).toBe("web");
      expect(joinOriginOf({ returnTo: "https://evil.example/cli/auth" })).toBe(
        "web",
      );
    });
  });
});
