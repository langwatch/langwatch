import { z } from "zod";

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

/** An admitted assertion, as the user resolver reads it: who asserted whom. */
export interface SsoUserResolutionInput {
  protocol: "oidc" | "saml";
  providerId: string;
  accountKey: Readonly<{ issuer: string; accountId: string }>;
  email: string;
  /** The OIDC provider's word that it verified the address; SAML carries none. */
  emailVerified: boolean;
}

/**
 * Which existing person an admitted assertion signs in as. `continue` leaves
 * the choice to the sign-in library's own rule; `OAuthAccountNotLinked` is
 * that library's refusal, kept so the screen reads what it always read.
 */
export type SsoUserResolution =
  | Readonly<{ action: "continue" }>
  | Readonly<{ action: "link"; userId: string; profile: "preserve" }>
  | Readonly<{
      action: "reject";
      code: "OAuthAccountNotLinked" | "sso_existing_account_unconfirmed";
    }>;

/**
 * Where somebody's own sign-in leaves them: testing a connection that has not
 * gone live, named so a screen can say which organization was being proved.
 * A union rather than a nullable, so "not a tester" is an answer.
 */
export const ssoTestArrivalStandingSchema = z.discriminatedUnion("testing", [
  z
    .object({
      testing: z.literal(true),
      connectionId: z.string(),
      organizationId: z.string(),
      organizationName: z.string(),
    })
    .strict(),
  z.object({ testing: z.literal(false) }).strict(),
]);
export type SsoTestArrivalStanding = z.infer<typeof ssoTestArrivalStandingSchema>;

/** The answer for everybody who is not proving a connection. */
export const NOT_A_TEST_ARRIVAL: SsoTestArrivalStanding = { testing: false };
