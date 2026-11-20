/**
 * Pins the sign-in error codes the installed Better Auth redirects with against the contract's
 * normaliser, so an upgrade that adds or renames one fails here instead of falling through to
 * the generic error screen.
 * @see specs/identity/scim-sso-signin.feature
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { isStableAuthError, normalizeSignInErrorCode } from "@langwatch/auth-contract";
import { describe, expect, it } from "vitest";

const DIFFERENT_EMAIL = "DIFFERENT_EMAIL_NOT_ALLOWED";
const NOT_LINKED = "OAuthAccountNotLinked";

/** Every `?error=` code of Better Auth's OAuth callback, and the screen code it must reach. */
const CLASSIFIED: Record<string, string> = {
  no_code: "not a link refusal",
  oauth_provider_not_found: "not a link refusal",
  issuer_missing: "not a link refusal",
  issuer_mismatch: "not a link refusal",
  invalid_code: "not a link refusal",
  nonce_binding_missing: "not a link refusal",
  unable_to_get_user_info: "not a link refusal",
  no_callback_url: "not a link refusal",
  unable_to_link_account: "not a link refusal",
  email_does_not_match: DIFFERENT_EMAIL,
  account_already_linked_to_different_user: NOT_LINKED,
  email_not_found: "not a link refusal",
  email_not_verified: "not a link refusal",
  // The sign-in path's refusal for an existing account under another method; the callback
  // swaps the spaces of "account not linked" for underscores before it redirects.
  account_not_linked: NOT_LINKED,
  unable_to_update_account: "not a link refusal",
  unable_to_create_user: "not a link refusal",
  unable_to_create_session: "not a link refusal",
  signup_disabled: "not a link refusal",
};

/** What the normaliser answered for each code before its dead spellings were pruned. */
const BEFORE_PRUNING: Record<string, string> = {
  email_does_not_match: DIFFERENT_EMAIL,
  account_already_linked_to_different_user: NOT_LINKED,
  account_not_linked: NOT_LINKED,
};

const libraryDir = path.dirname(createRequire(import.meta.url).resolve("better-auth/oauth2"));
const libraryFile = (name: string): string => readFileSync(path.join(libraryDir, name), "utf8");

/** The codes of `OAUTH_CALLBACK_ERROR_CODES`, which `better-auth/oauth2` does not export. */
function callbackCodes(): string[] {
  const block = /OAUTH_CALLBACK_ERROR_CODES\s*=\s*\{([^}]*)\}/.exec(libraryFile("errors.mjs"));
  const codes = [...(block?.[1] ?? "").matchAll(/:\s*"([^"]+)"/g)].map((match) => match[1] ?? "");
  expect(codes.length, "OAUTH_CALLBACK_ERROR_CODES not found in better-auth").toBeGreaterThan(0);
  return codes;
}

/** The sign-in path's `result.error` strings, as the callback redirects with them. */
function signInResultCodes(): string[] {
  return [...libraryFile("link-account.mjs").matchAll(/\berror:\s*"([a-z][a-z ]+)"/g)].map(
    (match) => (match[1] ?? "").split(" ").join("_"),
  );
}

describe("given the installed Better Auth", () => {
  const live = [...new Set([...callbackCodes(), ...signInResultCodes()])];

  describe("when it redirects a failed sign-in or link to the error screen", () => {
    /** @scenario "An upgrade that adds or renames a library code fails until the code is classified" */
    it("sends only codes this suite has classified", () => {
      expect(live.filter((code) => !(code in CLASSIFIED))).toEqual([]);
    });

    it("still sends every code this suite classifies", () => {
      expect(Object.keys(CLASSIFIED).filter((code) => !live.includes(code))).toEqual([]);
    });

    /** @scenario "Every link refusal the installed library redirects with has a specific screen code" */
    it.each(Object.entries(CLASSIFIED).filter(([, screen]) => screen !== "not a link refusal"))(
      "maps %s to the specific screen code %s, which is stable",
      (code, screen) => {
        expect(normalizeSignInErrorCode(code)).toBe(screen);
        expect(isStableAuthError(screen)).toBe(true);
      },
    );

    it.each(Object.entries(CLASSIFIED).filter(([, screen]) => screen === "not a link refusal"))(
      "leaves %s as it is, for the generic error screen",
      (code) => {
        expect(normalizeSignInErrorCode(code)).toBe(code);
      },
    );
  });

  describe("when each live code is read again after the pruning", () => {
    /** @scenario "Every code the library sends keeps the screen code it had before" */
    it.each(live)("keeps the screen code %s had before", (code) => {
      const before = BEFORE_PRUNING[code] ?? code;
      expect(normalizeSignInErrorCode(code)).toBe(before);
      expect(isStableAuthError(normalizeSignInErrorCode(code))).toBe(isStableAuthError(before));
    });
  });
});
