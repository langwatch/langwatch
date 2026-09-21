import type { RoutingDecision } from "@langwatch/identity-contract";
import { moduleApi } from "@langwatch/kernel/module-api";

import type {
  BrowserSession,
  BrowserSessionInventoryEntry,
  VerifiedBrowserSession,
} from "./browser-session.ts";
import type { InviteLanding, SignUpVerificationResult } from "./front-door.responses.ts";

/**
 * The subject carried by an unexpired CLI access bearer. The device-session
 * store remains Auth-owned; peers receive only the caller facts they need.
 */
export type CliAccessSession = Readonly<{
  userId: string;
  organizationId: string;
  clientInfo?: Readonly<{
    deviceLabel?: string | undefined;
    hostname?: string | undefined;
  }>;
}>;

/**
 * Everything the auth module does for a caller: the signed-in browser session,
 * and the signed-out front door that stands before they have one — one
 * interface because it is one module, meeting at the same person.
 */
export interface AuthApi {
  /**
   * Whether this deployment offers passkeys. `PASSKEYS_ENABLED` has one owner,
   * this module; a peer asks rather than declaring the variable a second time.
   */
  offersPasskeys(): boolean;
  /**
   * Whether Better Auth accepts the token. Carries the RAW auth-session id
   * an impersonation starts/stops against; a process with no sign-in door
   * composed answers null, so callers are anonymous rather than failing.
   */
  tryVerifyBrowserSession(input: { headers: Headers }): Promise<VerifiedBrowserSession | null>;
  /** A missing, revoked, expired, or unusable session resolves to null. */
  tryResolveBrowserSession(input: {
    verified: VerifiedBrowserSession | null;
  }): Promise<BrowserSession | null>;
  /** Resolves an unexpired CLI device-session bearer, or no caller. */
  findCliAccessSession(input: {
    authorization: string | null | undefined;
  }): Promise<CliAccessSession | null>;
  /** Severs the presented CLI bearer and its owner index entry. */
  revokeCliAccessToken(input: {
    authorization: string | null | undefined;
    userId: string;
  }): Promise<void>;
  /**
   * What this person is signed in on, newest first, and how each signed in.
   * The reading half of ending a session: a list with no action on it leaves
   * somebody who lost a laptop with nothing to do.
   */
  listBrowserSessions(input: {
    userId: string;
    currentSessionId?: string | undefined;
  }): Promise<readonly BrowserSessionInventoryEntry[]>;
  /**
   * End ONE of this person's sessions, found in their OWN list rather than
   * deleted by id, so naming somebody else's session ends nothing. Ending the
   * session doing the reading raises `session_is_current`.
   */
  endBrowserSession(input: {
    userId: string;
    sessionId: string;
    currentSessionId?: string | undefined;
  }): Promise<{ ended: number }>;
  revokeAllBrowserSessions(input: { userId: string }): Promise<void>;
  revokeBrowserSession(input: { sessionId: string }): Promise<void>;
  revokeOtherBrowserSessions(input: { userId: string; keepSessionId: string }): Promise<void>;

  /** Whether this attempt is inside the budget the door asked for, and how
   *  long to wait when it is not — the refusal's words name the seconds. */
  isWithinBudget(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; retryAfterSeconds?: number | undefined }>>;
  /** Where this address signs in. The decision object IS the contract. */
  route(
    input: Readonly<{ identifier: string | null; breakGlass: boolean }>,
  ): Promise<RoutingDecision>;
  /** Whether an account already exists for this address. */
  addressIsRegistered(input: Readonly<{ email: string }>): Promise<boolean>;
  /** Mails a fresh confirmation link. Asking twice sends twice. */
  requestSignUpVerification(input: Readonly<{ email: string }>): Promise<void>;
  /** Spends a confirmation link and answers the address it confirmed. */
  completeSignUpVerification(input: Readonly<{ token: string }>): Promise<SignUpVerificationResult>;
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
   * Which sign-in mode the deployment offers. ADR-027: reports "email"
   * whenever the license gate denies SSO, so the page never auto-redirects
   * to a disabled identity provider. Single source of truth.
   */
  resolveAuthProvider(): Promise<string>;
}

/**
 * The browser-session half of the API, for callers needing only it: the
 * cookie-resolving request boundary and the session-ending features. Named
 * rather than spelled out — the whole module also pulls in the sign-in door.
 */
export type BrowserSessionApi = Pick<
  AuthApi,
  | "tryVerifyBrowserSession"
  | "tryResolveBrowserSession"
  | "listBrowserSessions"
  | "endBrowserSession"
  | "revokeAllBrowserSessions"
  | "revokeBrowserSession"
  | "revokeOtherBrowserSessions"
>;

export const AuthApi = moduleApi<AuthApi>()("auth");
