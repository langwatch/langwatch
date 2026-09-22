// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Whose words a test sign-in's refusal is in. The bound claims are on the
 * notice that renders them; what this pins is the split — ours carry advice
 * and no quotation, theirs carry the quotation.
 */
import { describe, expect, it } from "vitest";

import { testSignInFailureFor, testSignInFailureIsOurs } from "../test-sign-in-failure.ts";

describe("given one of our own codes", () => {
  it("answers our words, and quotes nothing", () => {
    for (const code of [
      "OAuthAccountNotLinked",
      "sso_setup_address_mismatch",
      "sso_assertion_without_address",
      "sso_domain_not_verified",
      "sso_domain_proof_lapsed",
      "sso_sign_in_refused",
    ]) {
      const failure = testSignInFailureFor({ code });

      expect(testSignInFailureIsOurs(code)).toBe(true);
      expect(failure.detail).toBeNull();
      expect(failure.title).not.toContain("sent you back");
      expect(failure.advice.length).toBeGreaterThan(0);
    }
  });

  it("leaves the reader's own address out where the session has not answered it", () => {
    const failure = testSignInFailureFor({ code: "sso_setup_address_mismatch" });

    expect(failure.advice).not.toContain("yours is");
    expect(failure.advice).toContain("add the address your provider does use");
  });
});

describe("given a code that is not ours", () => {
  it("quotes it, with the description where the provider sent one", () => {
    expect(testSignInFailureIsOurs("access_denied")).toBe(false);
    expect(testSignInFailureFor({ code: "access_denied" }).detail).toBe("access_denied");
    expect(
      testSignInFailureFor({ code: "access_denied", description: "not assigned" }).detail,
    ).toBe("access_denied: not assigned");
  });
});
