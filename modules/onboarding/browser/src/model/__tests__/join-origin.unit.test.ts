/**
 * @vitest-environment node
 * @see specs/members/developer-seat.feature
 * Where a join request made from the welcome screen comes from, read off its continuation.
 */
import { describe, expect, it } from "vitest";

import { joinOriginOf } from "../join-origin.ts";

describe("joinOriginOf()", () => {
  describe("when the welcome screen was reached from the device-approval page", () => {
    /** @scenario A request made from the terminal lands as a Developer when approved */
    it("is the terminal", () => {
      expect(joinOriginOf({ returnTo: "/cli/auth?user_code=ABCD-EFGH" })).toBe("cli");
      expect(joinOriginOf({ returnTo: "/cli/auth" })).toBe("cli");
    });
  });

  describe("when it was reached any other way", () => {
    /** @scenario A request made on the web keeps the organisation's joiner seat */
    it("is the web", () => {
      expect(joinOriginOf({ returnTo: null })).toBe("web");
      expect(joinOriginOf({ returnTo: undefined })).toBe("web");
      expect(joinOriginOf({ returnTo: "/settings" })).toBe("web");
      expect(joinOriginOf({ returnTo: "/cli/authority" })).toBe("web");
    });
  });
});
