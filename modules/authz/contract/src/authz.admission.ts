/**
 * Where an automatic single-sign-on admission stands: the membership carries
 * the grant intent, the ledger says whether the grant landed. ADR-129.
 */
export type AuthzAdmissionState = "pending" | "applied" | "revoked";

export type AuthzPendingAdmission = Readonly<{
  grantId: string;
  occurredAtMs: number;
  state: AuthzAdmissionState;
}>;

export type AuthzAdmissionScope = Readonly<{
  organizationId: string;
  userId: string;
}>;

/**
 * `pending: false` is the common answer: most memberships carry no unfinished
 * admission, and that is a fact the caller acts on rather than an absence.
 */
export type AuthzPendingAdmissionRead =
  | Readonly<{ pending: true; admission: AuthzPendingAdmission }>
  | Readonly<{ pending: false }>;

export type AuthzResolveAdmissionInput = AuthzAdmissionScope & Readonly<{ grantId: string }>;
