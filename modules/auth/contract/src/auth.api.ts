import type { InviteLanding, SignUpVerificationResult } from "./front-door.responses.ts";
import type { RoutingDecision } from "@langwatch/identity-contract";
import { moduleApi } from "@langwatch/runtime-composition";
import type { BrowserSession, VerifiedBrowserSession } from "./browser-session.ts";

/**
 * Everything the auth module does for a caller: the browser session a signed-in
 * person holds, and the signed-out front door that stands before they have one.
 *
 * One interface because it is one module and one application. The two halves
 * meet at the same person: the door decides where an address signs in and mints
 * the account, and the session half is what the browser holds afterwards.
 */
export interface AuthApi {
  /**
   * Whether Better Auth accepts the session token these headers carry.
   *
   * The deployment's own request boundary, and the half that carries the RAW
   * auth-session id an impersonation is started and stopped against. A process
   * that composed no sign-in door answers null, so its callers are anonymous
   * rather than failing.
   */
  tryVerifyBrowserSession(input: {
    headers: Headers;
  }): Promise<VerifiedBrowserSession | null>;
  /** A missing, revoked, expired, or unusable session resolves to null. */
  tryResolveBrowserSession(input: {
    verified: VerifiedBrowserSession | null;
  }): Promise<BrowserSession | null>;
  revokeAllBrowserSessions(input: { userId: string }): Promise<void>;
  revokeBrowserSession(input: { sessionId: string }): Promise<void>;
  revokeOtherBrowserSessions(input: { userId: string; keepSessionId: string }): Promise<void>;

  /** Whether this attempt is inside the budget the door asked for. */
  isWithinBudget(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<boolean>;
  /** Where this address signs in. The decision object IS the contract. */
  route(
    input: Readonly<{ identifier: string | null; breakGlass: boolean }>,
  ): Promise<RoutingDecision>;
  /** Whether an account already exists for this address. */
  addressIsRegistered(input: Readonly<{ email: string }>): Promise<boolean>;
  /** Mails a fresh confirmation link. Asking twice sends twice. */
  requestSignUpVerification(input: Readonly<{ email: string }>): Promise<void>;
  /** Spends a confirmation link and answers the address it confirmed. */
  completeSignUpVerification(
    input: Readonly<{ token: string }>,
  ): Promise<SignUpVerificationResult>;
  /**
   * The invitation behind a code. Missing and revoked both raise `invite_not_found`
   * to prevent code guessing; expired raises `invite_expired` for recovery (D11).
   */
  readInviteLanding(input: Readonly<{ inviteCode: string }>): Promise<InviteLanding>;
  /**
   * Tells the organization's admins that somebody holding a stale code is
   * waiting. Mints nothing: letting a stale code refresh itself would make
   * the expiry decorative.
   */
  requestFreshInvite(input: Readonly<{ inviteCode: string }>): Promise<void>;
  /**
   * Which sign-in mode the deployment offers.
   *
   * ADR-027: reports "email" whenever the license gate denies SSO, so the
   * sign-in page renders the email form and never auto-redirects to a disabled
   * identity provider. This is the single source of truth.
   */
  resolveAuthProvider(): Promise<string>;
}

/**
 * The browser-session half of the API, for the callers that need only it: the
 * request boundary that resolves a cookie, and the features that end somebody's
 * sessions. Named rather than spelled out, because it is the same four
 * operations everywhere and a caller asking for the whole module would be
 * asking for the signed-out door as well.
 */
export type BrowserSessionApi = Pick<
  AuthApi,
  | "tryVerifyBrowserSession"
  | "tryResolveBrowserSession"
  | "revokeAllBrowserSessions"
  | "revokeBrowserSession"
  | "revokeOtherBrowserSessions"
>;

export const AuthApi = moduleApi<AuthApi>("auth");
