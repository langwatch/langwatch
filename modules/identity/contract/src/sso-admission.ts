import type { SsoAssertionRefusedError } from "./identity.errors.ts";

/** The person arriving, as every step of an admission names them. */
export interface SsoArrivingUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Internal reasons identify the failure; the customer error carries what is
 * actionable. A cause stays opaque when naming it would say what exists
 * inside LangWatch, because that is how connection identifiers get enumerated.
 */
export type SsoAssertionRefusalReason =
  | "provider-is-not-a-connection"
  | "assertion-carried-no-address"
  | "connection-not-found"
  | "connection-not-accepting-sign-in"
  | "connection-has-no-registrant"
  | "setup-address-mismatch"
  | "domain-not-verified"
  | "domain-proof-lapsed";

export interface SsoAssertionRefusal {
  action: "reject";
  reason: SsoAssertionRefusalReason;
  /** The refusal as the rest of the platform states one; the seam that
   *  answers the provider plugin reads its `code`. */
  error: SsoAssertionRefusedError;
}

export type SsoAssertionDecision = Readonly<{ action: "continue" }> | SsoAssertionRefusal;
