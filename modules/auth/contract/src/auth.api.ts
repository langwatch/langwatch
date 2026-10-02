import type {
  EmailIdentifierAdded,
  RoutingDecision,
  SignedInWith,
} from "@langwatch/identity-contract";
import { moduleApi } from "@langwatch/module";
import { z } from "zod";

import type {
  BrowserSessionInventoryEntry,
  BrowserSessionResolution,
  BrowserSessionVerification,
  VerifiedBrowserSession,
} from "./browser-session.ts";
import type {
  AuthFederatedPasswordChange,
  AuthFederatedPasswordOutcome,
} from "./federated-password.ts";
import type {
  AddressConfirmation,
  InviteLanding,
  PriorSession,
  SignUpEnrollment,
  SignUpVerificationRequest,
} from "./front-door.responses.ts";
import type {
  ReleaseHeldAccountResult,
  SaveSignInSecurityInput,
  SaveSignInSecurityResult,
  SignInSecuritySettings,
} from "./sign-in-security.ts";

/**
 * The subject carried by an unexpired CLI access bearer. The device-session
 * store remains Auth-owned; peers receive only the caller facts they need.
 */
export const cliAccessSessionSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
  /** The one project the session is capped at; absent for a session bound to none. */
  projectId: z.string().optional(),
  /** Set when the person consented to that one project only (hosted MCP); never org-wide. */
  projectLocked: z.boolean().optional(),
  /** The login key the session minted at sign-in, where it minted one. */
  cliApiKeyId: z.string().optional(),
  clientInfo: z
    .object({ deviceLabel: z.string().optional(), hostname: z.string().optional() })
    .optional(),
});
export type CliAccessSession = Readonly<z.infer<typeof cliAccessSessionSchema>>;

/** An access and refresh pair, with the seconds each lives. */
export type CliSessionTokens = Readonly<{
  accessToken: string;
  refreshToken: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}>;

/**
 * One CLI token a person holds, access or refresh, and the key that revokes
 * it. The device-session store stays Auth-owned; a peer reads these facts.
 */
export type CliTokenRecordEntry = Readonly<{
  tokenKey: string;
  organizationId: string;
  /** The login key the session minted at sign-in, where it minted one. */
  cliApiKeyId?: string | undefined;
  issuedAtMs: number;
  expiresAtMs: number;
  clientInfo?: Readonly<{
    deviceLabel?: string | undefined;
    hostname?: string | undefined;
    uname?: string | undefined;
    platform?: string | undefined;
    sessionStartedAtMs?: number | undefined;
  }>;
}>;

/**
 * What the install-wide usage report counts here (ADR-156, section 10): the
 * people signed in right now, one person on four devices counted once.
 */
export interface AuthUsageCount {
  readonly signedInUsers: number;
}

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
   * Whether this deployment offers two-step verification (`MFA_ENROLLMENT_OPEN`,
   * owned here). The account-security offer asks rather than redeclaring it.
   */
  offersTwoStepVerification(): boolean;
  /**
   * How this person signed in on this session, read off the factors it recorded.
   * `unknown` where the session recorded none or is not theirs: never a guess.
   */
  getSignedInWith(input: { userId: string; sessionId: string }): Promise<SignedInWith>;
  /**
   * Whether this deployment issues its own passwords beside a federated
   * provider (D09, `LOCAL_PASSWORDS_ENABLED`). Email mode issues them anyway.
   */
  issuesOwnPasswords(): boolean;
  /**
   * Identity-provider origins an operator runs on private addresses
   * (`SSO_TRUSTED_IDP_ORIGINS`, plus the worktree simulator outside production).
   * One owner, this module: issuer discovery asks rather than redeclaring them.
   */
  findDialableIdentityProviderOrigins(): string[];
  /**
   * Whether Better Auth accepts the token. Carries the RAW auth-session id
   * an impersonation starts/stops against; a process with no sign-in door
   * composed answers null, so callers are anonymous rather than failing.
   */
  verifyBrowserSession(input: { headers: Headers }): Promise<BrowserSessionVerification>;
  /** A missing, revoked, expired, or unusable session resolves as anonymous. */
  resolveBrowserSession(input: {
    verified: VerifiedBrowserSession;
  }): Promise<BrowserSessionResolution>;
  /** The CLI token door's verifier: the session and its severing key, or `invalid_credentials`. */
  getCliAccessSession(input: {
    authorization: string;
  }): Promise<CliAccessSession & Readonly<{ tokenKey: string }>>;
  /**
   * Mints the person-bound session a sign-in approved: an access token capped and
   * locked at one project, and a rotating refresh token. Refuses when the person
   * is no longer an active member who can view that project.
   */
  issueProjectCliSession(input: {
    userId: string;
    organizationId: string;
    projectId: string;
    clientLabel: string;
  }): Promise<CliSessionTokens>;
  /**
   * Rotates a refresh token into a new pair, keeping its person and project. The
   * old token ends; an unknown, expired or revoked one refuses as `invalid_grant`.
   */
  refreshCliSession(input: { refreshToken: string }): Promise<CliSessionTokens>;
  /** Every CLI token this person still holds; lapsed and unreadable ones are skipped. */
  findCliTokenRecordsForUser(input: { userId: string }): Promise<CliTokenRecordEntry[]>;
  /**
   * Revokes the named CLI tokens of this person, or every one they hold when
   * none are named. A key outside their own index revokes nothing.
   */
  revokeCliTokens(input: {
    userId: string;
    tokenKeys?: readonly string[] | undefined;
  }): Promise<{ revokedCount: number }>;
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
  /** Ends every one of this person's sessions one sign-in method minted, and no others. */
  endBrowserSessionsForIdentifier(input: {
    userId: string;
    identifierId: string;
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
  /**
   * The `/api/auth/*` origin rule for a sign-up that writes before any such call: `origin`, or
   * with none `referer`, must match the configured address. Throws `auth_invalid_origin`.
   */
  assertSignUpOrigin(
    input: Readonly<{ origin: string | null; referer: string | null }>,
  ): Promise<void>;
  /** Mails a fresh confirmation link. Asking twice sends twice. */
  requestSignUpVerification(input: Readonly<{ email: string }>): Promise<void>;
  /**
   * Mails a sign-up confirmation link, refusing an address that already has an account. Where
   * the installation has no email at all, it mails nothing and answers an unconfirmed proof.
   */
  requestNewAccountVerification(
    input: Readonly<{ email: string }>,
  ): Promise<SignUpVerificationRequest>;
  /**
   * Starts identity's PKCE ceremony for the signed-in caller's own address, metered per caller;
   * refuses an account with no address, and an installation that cannot send email.
   */
  sendMyAddressConfirmation(
    input: Readonly<{ actorId: string; email: string | null; codeChallenge: string }>,
  ): Promise<EmailIdentifierAdded>;
  /** The caller's own address and whether it is confirmed; unconfirmed where it has none. */
  getMyAddressConfirmation(input: Readonly<{ email: string | null }>): Promise<AddressConfirmation>;
  /**
   * The methods a proven address may enrol, validating the proof without spending it;
   * a proof that is missing, expired or another address's raises `auth_no_address_to_confirm`.
   */
  getSignUpEnrollment(
    input: Readonly<{ email: string; addressProof: string }>,
  ): Promise<SignUpEnrollment>;
  /** Classifies the caller's own session cookie; only an expired one names its address. */
  getPriorSession(input: Readonly<{ headers: Headers }>): Promise<PriorSession>;
  /** The amr the session recorded; empty when the session is gone. */
  findSessionAmr(input: { sessionId: string }): Promise<string[]>;
  /** The distinct amr across unexpired sessions these people minted through these identifiers. */
  findAssertedAmrForIdentifiers(input: {
    userIds: readonly string[];
    identifierIds: readonly string[];
  }): Promise<string[]>;
  /**
   * Turns the caller's authenticator off: the code is checked first, then the password
   * re-proof, where a mismatch raises `identity_mfa_password_invalid`.
   */
  disableTwoStepVerification(input: {
    headers: Headers;
    password?: string | undefined;
    code: string;
  }): Promise<void>;
  /**
   * Spends the single-use proof a spent link minted for an address with no
   * account. False for a proof that is missing, expired, spent or another address's.
   */
  claimSignUpAddressProof(input: Readonly<{ token: string; email: string }>): Promise<boolean>;
  /**
   * Spends an unconfirmed proof, minted where the installation could not send email. False
   * for a proof that is missing, expired, spent, another address's, or once email works.
   */
  claimUnconfirmedSignUpAddressProof(
    input: Readonly<{ token: string; email: string }>,
  ): Promise<boolean>;
  /**
   * Creates the provider account a confirmed link proposal earned, through Better Auth, so
   * the ordinary account ceremony runs; the issuer is the connection's own, else the provider's.
   */
  linkProviderAccount(
    input: Readonly<{
      userId: string;
      connectionId: string | null;
      provider: string;
      subject: string;
      normalizedEmail: string;
    }>,
  ): Promise<void>;
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
  /**
   * Retires the federated accounts a retiring SSO connection minted, and says
   * how many still stand. Auth owns every `Account` row, so a cutover asks
   * rather than deleting them itself (ADR-129).
   */
  retireLegacySsoAccess(
    input: LegacySsoAccessQuery,
  ): Promise<{ retired: number; remaining: number }>;
  /** The same reading, retiring nothing: what a finalization re-reads between
   *  its steps to see whether legacy access is actually gone. */
  countLegacySsoAccess(input: LegacySsoAccessQuery): Promise<number>;
  /**
   * Which identity providers this person holds an account through, each named
   * once. Auth owns every `Account` row, so a peer deciding something about
   * them asks rather than reading them (ADR-129).
   */
  findFederatedAccountProviders(input: { userId: string }): Promise<string[]>;
  /**
   * Changes the password the Auth0 tenant holds for this person's database
   * identity: the current one is proven first. Main's `changeFederatedPassword`;
   * whether a tenant is configured is decided on each call.
   */
  changeFederatedPassword(
    input: AuthFederatedPasswordChange,
  ): Promise<AuthFederatedPasswordOutcome>;
  /**
   * Whether this person still owes the single sign-on their address's
   * organization pins, asked of the accounts they hold now: live, never stored.
   */
  getSsoSetupStatus(input: {
    userId: string;
    email: string;
  }): Promise<{ pendingSsoSetup: boolean }>;
  /** The organization's two sign-in security rules, all zero when unset. */
  getSignInSecuritySettings(input: { organizationId: string }): Promise<SignInSecuritySettings>;
  /**
   * Saves both rules, asking for the Enterprise plan only when a rule turns on
   * from fully off, then ends every member session already past the window.
   */
  saveSignInSecuritySettings(input: SaveSignInSecurityInput): Promise<SaveSignInSecurityResult>;
  /** Releases a member the organization holds after a fifth consecutive lock-out. */
  releaseHeldAccount(input: {
    organizationId: string;
    userId: string;
    actorUserId: string;
  }): Promise<ReleaseHeldAccountResult>;
  /** The usage report's figure (ADR-156, section 10), install-wide. */
  countUsage(input: { at: number }): Promise<AuthUsageCount>;
  /** The same figure for one organization, counted over the members the caller names. */
  countUsageForMembers(input: {
    memberUserIds: readonly string[];
    at: number;
  }): Promise<AuthUsageCount>;
}

/** Which accounts a legacy-access question is about: the connection being
 *  retired, and nothing the asking module does not own. Auth resolves the
 *  members and the provider itself, from the modules that own each. */
export interface LegacySsoAccessQuery {
  organizationId: string;
  connectionId: string;
  /** Members whose legacy account is still their only way in: theirs is kept
   *  and not counted, and the replacement matches them at their next sign-in. */
  strandedUserIds: readonly string[];
}

/**
 * The browser-session half of the API, for callers needing only it: the
 * cookie-resolving request boundary and the session-ending features. Named
 * rather than spelled out — the whole module also pulls in the sign-in door.
 */
export type BrowserSessionApi = Pick<
  AuthApi,
  | "verifyBrowserSession"
  | "resolveBrowserSession"
  | "listBrowserSessions"
  | "endBrowserSession"
  | "revokeAllBrowserSessions"
  | "revokeBrowserSession"
  | "revokeOtherBrowserSessions"
>;

export const AuthApi = moduleApi<AuthApi>()("auth");
