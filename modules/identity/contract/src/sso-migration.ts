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

/** A member who still holds no identifier on the replacement. */
export interface SsoMigrationStragglerView {
  userId: string;
  name: string | null;
  email: string | null;
  lastLegacyAuthenticationAtMs: number | null;
}

/** One reason finalizing would be premature, in the words the reader acts on. */
export interface SsoMigrationBlockerView {
  code: string;
  message: string;
}

/** Whether directory provisioning still points at the connection being retired. */
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
    stragglers: SsoMigrationStragglerView[];
    nextCursor: string | null;
  };
  quietPeriod: {
    lastLegacyAuthenticationAtMs: number | null;
    complete: boolean;
  };
  scim: { status: SsoMigrationScimStatus };
  blockers: SsoMigrationBlockerView[];
  canFinalize: boolean;
}
