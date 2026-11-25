import type { AuthzAdmissionScope, AuthzResolveAdmissionInput } from "@langwatch/authz-contract";

/** The grant intent a membership carries while its admission is unfinished. */
export type AuthzAdmissionMarkerRow =
  | Readonly<{ found: true; grantId: string; occurredAtMs: number }>
  | Readonly<{ found: false }>;

/** What the ledger says about the grant that marker named. */
export type AuthzAdmissionGrantRow =
  | Readonly<{ found: true; revoked: boolean }>
  | Readonly<{ found: false }>;

/**
 * The unfinished-admission state: the marker a live membership carries and
 * the ledger row it names. Reading them is two questions because they are two
 * facts; what the pair MEANS is the service's, not this repository's.
 */
export abstract class AuthzAdmissionRepository {
  /** The marker on a membership that can still be signed into. */
  abstract readAdmissionMarker(input: AuthzAdmissionScope): Promise<AuthzAdmissionMarkerRow>;

  /** The organization-scoped USER grant the marker named, if it landed. */
  abstract readAdmissionGrant(input: AuthzResolveAdmissionInput): Promise<AuthzAdmissionGrantRow>;

  /**
   * Clears the marker, but only while the grant is live and the person can
   * still sign in — the whole precondition in the same statement, so a grant
   * revoked between the read and the write cannot be completed over.
   */
  abstract completeAdmission(input: AuthzResolveAdmissionInput): Promise<boolean>;

  /** Clears the marker unconditionally, for an admission the ledger revoked. */
  abstract clearPendingAdmission(input: AuthzResolveAdmissionInput): Promise<boolean>;
}
