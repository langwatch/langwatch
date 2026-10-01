import type {
  SsoConnectionSource,
  SsoDomainProofState,
  SsoMigrationPhase,
  SsoMigrationRoute,
  SsoVerificationMethod,
} from "./connection.ts";

/** One half of the pair, as the journey names it. */
export interface SsoMigrationConnectionRef {
  connectionId: string;
  source: SsoConnectionSource;
  providerId: string;
}

/**
 * Why a callback arriving mid-cutover may not link. Better Auth's own code
 * spelling, because that is what the refusal travels to the sign-in screen
 * as (`?error=`) — these are transport codes, not application codes.
 */
export type SsoMigrationLinkRefusalCode =
  | "SSO_MIGRATION_LINK_UNVERIFIED"
  | "SSO_MIGRATION_LINK_AMBIGUOUS"
  | "SSO_MIGRATION_LINK_NOT_ALLOWED"
  | "SSO_LEGACY_AUTH_RETIRED";

/**
 * What the cutover makes of one account arriving through a callback: which
 * connection the arrival belongs to, or the refusal. `not_migrating` is the
 * answer for the overwhelming majority — no pair, nothing to decide.
 */
export type SsoMigrationAccountLinkDecision =
  | { kind: "not_migrating" }
  /** A standalone grandfathered connection with canonical domain proof. */
  | { kind: "allow_connection"; arrivalConnectionId: string }
  /** The exact connection this callback arrived through, of the pair's two. */
  | { kind: "allow_replacement_pair"; arrivalConnectionId: string }
  | { kind: "reject"; code: SsoMigrationLinkRefusalCode };

/**
 * Why a sign-in arriving mid-cutover may not mint a session. Better Auth's
 * own code spelling, for the same reason the link refusals are.
 */
export type SsoMigrationAuthenticationRefusalCode =
  | "SSO_LEGACY_AUTH_RETIRED"
  | "SSO_MIGRATION_AUTH_AMBIGUOUS"
  | "SSO_MIGRATION_AUTH_NOT_ALLOWED";

/**
 * What the cutover makes of a callback that is about to mint a session:
 * `continue` for everything outside a cutover, and a refusal for a way in the
 * cutover has already closed.
 */
export type SsoMigrationAuthenticationDecision =
  | { action: "continue" }
  | { action: "reject"; code: SsoMigrationAuthenticationRefusalCode };

/**
 * Whether the replacement recognises a member by address. `matched` members
 * move across at their next sign-in; every other value names why the
 * replacement will not recognise them. None of them holds the update.
 */
export type SsoMigrationMemberMove =
  | "matched"
  | "no-address"
  | "shared-address"
  | "unproved-domain";

/** A member who still holds no identifier on the replacement. */
export interface SsoMigrationStragglerView {
  userId: string;
  name: string | null;
  email: string | null;
  lastLegacyAuthenticationAtMs: number | null;
  move: SsoMigrationMemberMove;
}

/** One reason finalizing would be premature, in the words the reader acts on. */
export interface SsoMigrationBlockerView {
  code: string;
  message: string;
}

/** Whether directory provisioning is on the replacement, or still has to be repointed. */
export type SsoMigrationScimStatus = "not-applicable" | "needs-repointing" | "ready";

/**
 * Where one organization's legacy-to-direct cutover stands. Everything here
 * is re-read on every request: finalization never trusts a snapshot a screen
 * was holding.
 */
export interface SsoMigrationView {
  legacy: SsoMigrationConnectionRef;
  replacement: SsoMigrationConnectionRef;
  phase: SsoMigrationPhase;
  selectedRoute: SsoMigrationRoute;
  /** The proofs the replacement was registered with, still qualifying. */
  inheritedDomains: {
    domain: string;
    method: SsoVerificationMethod;
    proofState: SsoDomainProofState;
    /** What the proof was read back against; null for one that published
     *  nothing. */
    evidenceRef: string | null;
    verifiedAtMs: number;
  }[];
  testSignIn: { done: boolean; atMs: number | null };
  members: {
    activeCount: number;
    linkedCount: number;
    /** Members the replacement will match at their next sign-in. */
    nextSignInCount: number;
    stragglers: SsoMigrationStragglerView[];
    nextCursor: string | null;
  };
  quietPeriod: {
    lastLegacyAuthenticationAtMs: number | null;
    /** When finishing opens, or null before sign-in is switched over. */
    clearsAtMs: number | null;
    complete: boolean;
  };
  scim: { status: SsoMigrationScimStatus };
  blockers: SsoMigrationBlockerView[];
  canFinalize: boolean;
}
