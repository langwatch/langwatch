/**
 * Auth's published capability: a sign-in that NAMES A CONNECTION, and one
 * spelling for a sign-in code. Travels by declaration, so a peer never
 * imports this closed package (ARCHITECTURE.md §10.1).
 */

import { normalizeSignInErrorCode } from "../model/sign-in-error-code.ts";
import {
  signInRefusalOf,
  signInStartFailureOf,
  ssoSignInAddressOf,
  type SignInStartFailure,
} from "../model/sso-sign-in-answer.ts";
import { testSignInCallbackUrl } from "../model/test-sign-in-callback-url.ts";
import { hardNavigate } from "./browser-navigation.ts";

/** Better Auth's single sign-on entry, mounted under the auth base path. */
const SSO_SIGN_IN_PATH = "/api/auth/sign-in/sso";

export interface AuthSignInCapability {
  /** Resolves once the browser is leaving, or with what refused it. */
  testSignIn(options: {
    connectionId: string;
    callbackQuery: Readonly<Record<string, string | undefined>>;
  }): Promise<{ error?: SignInStartFailure | null }>;
  normalizeSignInErrorCode(code: string): string;
}

/** The two seams a test takes over: the request, and leaving the page. */
export interface SignInCapabilityDeps {
  startSsoSignIn: (body: {
    providerId: string;
    callbackURL: string;
  }) => Promise<{ data?: unknown; error?: unknown }>;
  navigate: (url: string) => void;
  currentHref: () => string;
}

export function createSignInCapability(deps: SignInCapabilityDeps): AuthSignInCapability {
  return {
    async testSignIn({ connectionId, callbackQuery }) {
      const { data, error } = await deps.startSsoSignIn({
        providerId: connectionId,
        callbackURL: testSignInCallbackUrl({ href: deps.currentHref(), query: callbackQuery }),
      });
      const failure = signInStartFailureOf(error);
      if (failure) return { error: failure };
      // The provider's address, followed here: this is a whole-page journey
      // out to the identity provider and back, not a fetch with an answer.
      const address = ssoSignInAddressOf(data);
      if (address) deps.navigate(address);

      return { error: null };
    },
    normalizeSignInErrorCode(code: string): string {
      return normalizeSignInErrorCode(code) ?? code;
    },
  };
}

export const signInCapability: AuthSignInCapability = createSignInCapability({
  startSsoSignIn: async (body) => {
    const response = await fetch(SSO_SIGN_IN_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const answered: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        error: signInRefusalOf({
          status: response.status,
          statusText: response.statusText,
          body: answered,
        }),
      };
    }

    return { data: answered };
  },
  navigate: hardNavigate,
  currentHref: () => (typeof window === "undefined" ? "/" : window.location.href),
});

export default signInCapability;
