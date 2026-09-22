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
