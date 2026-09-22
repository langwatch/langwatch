import type {
  SsoArrivalPolicy,
  SsoConnectionLifecycleState,
  SsoConnectionSource,
  SsoConnectionType,
  SsoDomainProofState,
  SsoVerificationMethod,
} from "./connection.ts";
import type { SsoDomainOwnershipQualification } from "./sso-domain-ownership.ts";
import type { SelfServeActor } from "./sso-domain-proof.ts";

/** What one press on the setup journey names, beside the actor behind it. */
export interface SsoSetupCommand {
  organizationId: string;
  connectionId: string;
  actor: SelfServeActor;
}

/** Which removal a press sent — read from where the connection stands, never
 *  chosen by the caller. */
export type SsoConnectionRemoval = "discarded" | "teardown-requested";

/** One proved domain, with what its evidence is worth today (ADR-123). */
export interface SsoSetupDomainProofView {
  domain: string;
  method: SsoVerificationMethod;
  qualification: SsoDomainOwnershipQualification["status"];
  proofState: SsoDomainProofState;
  /** When a lapse becomes final; null while the evidence is there. */
  graceEndsAtMs: number | null;
  verifiedAtMs: number;
  /** Who proved it. `system` for the one-time legacy import, which names
   *  nobody. */
  verifier: { type: "user" | "system"; id: string | null };
}

/** A domain asked for and not yet proved. */
export interface SsoSetupDomainClaimView {
  domain: string;
  state: "CLAIMED" | "APPROVED" | "REJECTED";
  /** Why an operator refused it, so a re-claim starts from what they said. */
  note: string | null;
  /** Whether a person has to look before this one can go further. */
  waitsForReview: boolean;
}

/**
 * The ceremony in flight. The published value is issued once, at the claim,
 * and never kept — only its hash is — so a reader who lost it asks again
 * rather than reading it back off this view.
 */
export interface SsoSetupRecordView {
  domain: string;
  method: SsoVerificationMethod;
  expiresAtMs: number | null;
  expired: boolean;
}

/** What still stands between a connection and deciding sign-ins (D05). */
export interface SsoSetupGoLiveView {
  domainProved: boolean;
  /** Whether somebody has come all the way back in through this connection. */
  testSignIn: { done: boolean };
  breakGlass: { inPlace: boolean; liveCount: number };
  arrivalsDecided: boolean;
  ready: boolean;
  activated: boolean;
}

export interface SsoSetupConnectionView {
  connectionId: string;
  state: SsoConnectionLifecycleState;
  type: SsoConnectionType;
  providerId: string;
  issuer: string | null;
  source: SsoConnectionSource;
  arrivalPolicy: SsoArrivalPolicy;
  /** Null while the registration default stands: going live waits for a
   *  decision, and "turn everybody away" is a decision too. */
  arrivalPolicyDecidedAtMs: number | null;
  tearDownAfterMs: number | null;
  createdAtMs: number;
  verifiedDomains: string[];
  domainProofs: SsoSetupDomainProofView[];
}

/**
 * Where one organization's single sign-on setup stands, as the journey reads
 * it: identity's own folded state. The addresses an identity provider posts
 * to belong to the module serving them, and are not answered here.
 */
export interface SsoSetupView {
  /** The connection being set up or already deciding sign-ins, newest first
   *  among those an administrator can still act on; null before the first. */
  connection: SsoSetupConnectionView | null;
  claims: SsoSetupDomainClaimView[];
  record: SsoSetupRecordView | null;
  /** Null until there is a connection to take live. */
  goLive: SsoSetupGoLiveView | null;
  /** The compatibility route a grandfathered connection stands in for. */
  legacyRoute: { domain: string; provider: string } | null;
}
