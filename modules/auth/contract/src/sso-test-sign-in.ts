/** Auth's sign-in that names a connection, lent to SSO's "Test sign-in" by token (§10.1). */

import { uiTokens } from "@langwatch/module";

/** What refused a sign-in before the browser left: the provider's or the engine's answer. */
export type SignInStartRefusal = {
  code?: string;
  message?: string;
  statusText?: string;
  status?: number;
};

export type SsoTestSignInOperations = {
  /** Resolves once the browser is leaving, or with what refused it. */
  testSignIn(input: {
    connectionId: string;
    callbackQuery: Readonly<Record<string, string | undefined>>;
  }): Promise<{ error?: SignInStartRefusal | null }>;
  normalizeSignInErrorCode(code: string): string;
};

export const SsoTestSignInToken = uiTokens("auth").operations<SsoTestSignInOperations>("signIn");
