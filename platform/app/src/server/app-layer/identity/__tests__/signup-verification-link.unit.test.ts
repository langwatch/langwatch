/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

vi.mock("~/env.mjs", () => ({
  env: { BASE_HOST: "https://app.test" },
}));

import { buildSignUpVerificationUrl } from "../signup-verification-link";

/**
 * The emailed sign-up link, and the one thing it may carry besides the
 * token: a continuation on THIS site.
 *
 * `langwatch login` opens the browser on the device-approval page, which
 * starts the sign-up with that page as its continuation. The confirmation
 * link opens a fresh tab, and the continuation only survives the hop if the
 * link carries it. It is a redirect target, so it is held to a path on this
 * site and nothing else.
 *
 * Spec: specs/members/developer-seat.feature
 */
describe("buildSignUpVerificationUrl()", () => {
  describe("when the sign-up was started with a continuation on this site", () => {
    /** @scenario The emailed confirmation link brings the terminal's continuation along */
    it("carries it beside the token", () => {
      const url = new URL(
        buildSignUpVerificationUrl({
          token: "tok_1",
          callbackUrl: "/cli/auth?user_code=ABCD-EFGH",
        }),
      );

      expect(url.origin).toBe("https://app.test");
      expect(url.pathname).toBe("/auth/signup");
      expect(url.searchParams.get("verify")).toBe("tok_1");
      expect(url.searchParams.get("callbackUrl")).toBe(
        "/cli/auth?user_code=ABCD-EFGH",
      );
    });
  });

  describe("when the continuation is not a path on this site", () => {
    /** @scenario The emailed confirmation link brings the terminal's continuation along */
    it("drops it rather than mailing a link that leaves the site", () => {
      for (const callbackUrl of [
        "https://evil.example/steal",
        "//evil.example/steal",
        // Browsers read a backslash after the slash as a second slash.
        "/\\evil.example",
        "/\\/evil.example",
        // Control characters some agents strip before resolving.
        "/\t/evil.example",
        "/\r\n/evil.example",
        "/\0/evil.example",
        "javascript:alert(1)",
        "cli/auth",
        "",
        `/${"a".repeat(2048)}`,
      ]) {
        const url = new URL(
          buildSignUpVerificationUrl({ token: "tok_1", callbackUrl }),
        );
        expect(url.searchParams.has("callbackUrl")).toBe(false);
        expect(url.searchParams.get("verify")).toBe("tok_1");
      }
    });
  });

  describe("when there is no continuation", () => {
    it("is the plain link it always was", () => {
      expect(buildSignUpVerificationUrl({ token: "tok_1" })).toBe(
        "https://app.test/auth/signup?verify=tok_1",
      );
    });
  });
});
