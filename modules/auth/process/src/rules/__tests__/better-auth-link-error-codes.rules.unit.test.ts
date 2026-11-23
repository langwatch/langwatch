/**
 * Pins the sign-in error codes the installed Better Auth redirects with against the contract's
 * normaliser, so an upgrade that adds or renames one fails here instead of falling through to
 * the generic error screen.
 * @see specs/identity/sso-signin-error-boundary.feature
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { isStableAuthError, normalizeSignInErrorCode } from "@langwatch/auth-contract";
import { describe, expect, it } from "vitest";

const DIFFERENT_EMAIL = "DIFFERENT_EMAIL_NOT_ALLOWED";
const NOT_LINKED = "OAuthAccountNotLinked";
const LINKED_TO_ANOTHER = "ACCOUNT_LINKED_TO_ANOTHER_USER";
const NO_SCREEN = "no specific screen";
type Screen =
  | typeof DIFFERENT_EMAIL
  | typeof NOT_LINKED
  | typeof LINKED_TO_ANOTHER
  | typeof NO_SCREEN;

/**
 * The codes of `OAUTH_CALLBACK_ERROR_CODES` and of `link-account.mjs`'s `result.error` strings,
 * and the screen code each must reach. Literal redirects (`state_not_found`, ...) are not read.
 */
const CLASSIFIED: Record<string, Screen> = {
  no_code: NO_SCREEN,
  oauth_provider_not_found: NO_SCREEN,
  issuer_missing: NO_SCREEN,
  issuer_mismatch: NO_SCREEN,
  invalid_code: NO_SCREEN,
  nonce_binding_missing: NO_SCREEN,
  unable_to_get_user_info: NO_SCREEN,
  no_callback_url: NO_SCREEN,
  unable_to_link_account: NO_SCREEN,
  email_does_not_match: DIFFERENT_EMAIL,
  account_already_linked_to_different_user: LINKED_TO_ANOTHER,
  email_not_found: NO_SCREEN,
  email_not_verified: NO_SCREEN,
  // The sign-in path's refusal for an existing account under another method; the callback
  // swaps the spaces of "account not linked" for underscores before it redirects.
  account_not_linked: NOT_LINKED,
  "account not linked": NOT_LINKED,
  "unable to link account": NO_SCREEN,
  "unable to update account": NO_SCREEN,
  "unable to create user": NO_SCREEN,
  "unable to create session": NO_SCREEN,
  "signup disabled": NO_SCREEN,
  unable_to_update_account: NO_SCREEN,
  unable_to_create_user: NO_SCREEN,
  unable_to_create_session: NO_SCREEN,
  signup_disabled: NO_SCREEN,
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

/**
 * The sign-in path's `result.error` strings, as the OAuth callback redirects with them
 * (underscored) and as the SSO plugin's OIDC callback does (raw).
 */
function signInResultCodes(): string[] {
  return [...libraryFile("link-account.mjs").matchAll(/\berror:\s*"([^"]+)"/g)].flatMap((match) => [
    match[1] ?? "",
    (match[1] ?? "").split(" ").join("_"),
  ]);
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
    it.each(Object.entries(CLASSIFIED).filter(([, screen]) => screen !== NO_SCREEN))(
      "maps %s to the specific screen code %s, which is stable",
      (code, screen) => {
        expect(normalizeSignInErrorCode(code)).toBe(screen);
        expect(isStableAuthError(screen)).toBe(true);
      },
    );

    it.each(Object.entries(CLASSIFIED).filter(([, screen]) => screen === NO_SCREEN))(
      "leaves %s as it is, for the generic error screen",
      (code) => {
        expect(normalizeSignInErrorCode(code)).toBe(code);
      },
    );
  });
});
