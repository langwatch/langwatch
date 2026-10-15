/**
 * @vitest-environment node
 * @see specs/members/developer-seat.feature
 * The emailed sign-up link, and the one thing it may carry besides the token: a path on THIS site.
 */
import { describe, expect, it } from "vitest";

import { buildSignUpVerificationUrl } from "../signup-verification-link.rules.ts";

const baseUrl = "https://app.test";

describe("buildSignUpVerificationUrl()", () => {
  describe("when the sign-up was started with a continuation on this site", () => {
    /** @scenario The emailed confirmation link brings the terminal's continuation along */
    it("carries it beside the token", () => {
      const url = new URL(
        buildSignUpVerificationUrl({
          baseUrl,
          token: "tok_1",
          callbackUrl: "/cli/auth?user_code=ABCD-EFGH",
        }),
      );

      expect(url.origin).toBe("https://app.test");
      expect(url.pathname).toBe("/auth/signup");
      expect(url.searchParams.get("verify")).toBe("tok_1");
      expect(url.searchParams.get("callbackUrl")).toBe("/cli/auth?user_code=ABCD-EFGH");
    });
  });

  describe("when the continuation is not a path on this site", () => {
    /** @scenario The emailed confirmation link brings the terminal's continuation along */
    it("drops it rather than mailing a link that leaves the site", () => {
      for (const callbackUrl of [
        "https://evil.example/steal",
        "//evil.example/steal",
        "/\\evil.example",
        "/\\/evil.example",
        "/\t/evil.example",
        "/\r\n/evil.example",
        "/\0/evil.example",
        "javascript:alert(1)",
        "cli/auth",
        "",
        `/${"a".repeat(2048)}`,
      ]) {
        const url = new URL(buildSignUpVerificationUrl({ baseUrl, token: "tok_1", callbackUrl }));
        expect(url.searchParams.has("callbackUrl")).toBe(false);
        expect(url.searchParams.get("verify")).toBe("tok_1");
      }
    });
  });

  describe("when there is no continuation", () => {
    it("is the plain link it always was", () => {
      expect(buildSignUpVerificationUrl({ baseUrl, token: "tok_1" })).toBe(
        "https://app.test/auth/signup?verify=tok_1",
      );
    });
  });
});
