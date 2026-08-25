import type { SsoVerificationCeremonyMethod } from "./connection";

/**
 * Which self-serve onboarding tier an installation offers an organization,
 * and what it offers them to prove a domain with (D05 tiers 2 and 3).
 *
 * Pure and total, like the sign-in router next door: every branch a reviewer
 * might look for is here, decided from four facts, and a test enumerates the
 * whole table without a stub in sight. The surfaces call this and render the
 * answer; the guards refuse the same things independently, because a surface
 * is a courtesy and a guard is the rule.
 *
 * The one thing this deliberately never answers is attestation. Vouching for
 * a domain is a LangWatch operator's act on every deployment (D04
 * amendment), so it is not a value this function can return — an
 * administrator cannot reach it by any tier, and there is no configuration
 * under which the offer appears.
 */

export type SsoDeployment = "hosted" | "self-hosted";

/**
 * What the installation and the organization actually are, at the moment the
 * setup surface is opened.
 *
 * `licensed` is the licence gate ADR-027 froze AT STARTUP, not a live read.
 * That is the whole of why `licenseActivatedSinceStart` exists as a separate
 * fact: a licence activated while the installation is running is genuine and
 * still does not change what this process federates, so the honest answer is
 * "restart", not "yes".
 */
export interface SsoSelfServeContext {
  deployment: SsoDeployment;
  /** Whether the installation held a genuine licence when it started. */
  licensed: boolean;
  /** Whether a genuine licence has been activated since it started. */
  licenseActivatedSinceStart: boolean;
  /** Hosted only: whether this organization is opted in to self-serve. */
  optedIn: boolean;
}

/** Why setup is not available, in the vocabulary the error codes use. */
export type SsoSelfServeRefusal =
  | "license_required"
  | "license_restart_required"
  | "not_opted_in";

export type SsoSelfServeAvailability =
  | {
      available: true;
      /** How this organization proves a domain it claims. */
      proof: SsoVerificationCeremonyMethod;
      /**
       * Whether a claim waits for a LangWatch operator BY TIER — false
       * everywhere now, because a licence decides a self-hosted claim and a
       * published record decides a hosted one.
       *
       * It stays a field rather than becoming a constant because it is the
       * tier's answer and not the whole answer: one claim still reaches a
       * person, and it is the one on a domain another organization has
       * already proved. That is not a property of the tier — a pure table
       * cannot see other organizations' domains — so the service decides it
       * per claim and this stays what it always was.
       */
      claimWaitsForReview: boolean;
    }
  | { available: false; refusal: SsoSelfServeRefusal };

/**
 * The whole table:
 *
 *   self-hosted, licensed at startup     → licence proves it, nothing queued
 *   self-hosted, licensed since startup  → refuse, and say a restart is why
 *   self-hosted, never licensed          → refuse, and say a licence is why
 *   hosted, opted in                     → published record decides it
 *   hosted, not opted in                 → refuse, and offer a conversation
 *
 * Self-hosted is checked before the opt-in, because the opt-in is a hosted
 * concept: an installation with nobody to reach cannot be waiting for
 * somebody to opt it in.
 */
export function ssoSelfServeAvailability(
  context: SsoSelfServeContext,
): SsoSelfServeAvailability {
  if (context.deployment === "self-hosted") {
    if (context.licensed) {
      return {
        available: true,
        proof: "license-token",
        claimWaitsForReview: false,
      };
    }
    return {
      available: false,
      refusal: context.licenseActivatedSinceStart
        ? "license_restart_required"
        : "license_required",
    };
  }
  if (!context.optedIn) {
    return { available: false, refusal: "not_opted_in" };
  }
  // The record IS the decision, so nothing about the TIER waits for us. A
  // dispute still does, and the service answers that per claim.
  return { available: true, proof: "dns-txt", claimWaitsForReview: false };
}

/**
 * How long a published record stays a proof. Seven days: long enough that a
 * customer who has to raise a ticket with whoever runs their DNS still has
 * room, short enough that a token nobody used stops being one somebody else
 * could stumble into satisfying.
 */
export const SSO_DNS_PROOF_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long a domain whose record has gone missing keeps vouching for new
 * people before it stops (ADR-123). Forty-eight hours.
 *
 * Long enough to survive the two things that actually cause a false alarm — a
 * DNS migration done over a weekend, and an administrator who deleted the
 * record believing it was one-time — and short enough that a domain somebody
 * else now owns cannot quietly admit strangers for a week.
 *
 * The window is only ever advanced by a check that DEFINITIVELY found the
 * record absent. A lookup that failed says nothing about the customer's DNS,
 * so it neither starts this clock nor moves one along it: an outage of ours
 * must never spend a customer's grace.
 */
export const SSO_DNS_REPROOF_GRACE_MS = 48 * 60 * 60 * 1000;

/**
 * The name of the record a customer publishes. One label for every
 * organization on purpose: the VALUE is the secret, and a per-organization
 * label would put a customer's identifier in their public DNS.
 */
export const SSO_DNS_RECORD_NAME = "_langwatch-verification" as const;

/** What kind of record it is. Spelled out because a DNS control panel asks
 *  for it as a separate field, and guessing is how people publish a CNAME. */
export const SSO_DNS_RECORD_TYPE = "TXT" as const;

/**
 * The whole name the record lives at, which is what a customer's DNS
 * provider asks for when it wants a fully qualified name rather than a
 * label. Both are shown, because providers are split on which one they want
 * and publishing the wrong one is a support ticket.
 *
 * A dedicated label rather than the apex, and that is what lets the VALUE be
 * a bare token: nothing else publishes at `_langwatch-verification`, so
 * there is nothing to disambiguate it from. A vendor prefix inside the value
 * is what apex verification needs, because the apex is a shared shelf.
 */
export function ssoDnsRecordName({ domain }: { domain: string }): string {
  return `${SSO_DNS_RECORD_NAME}.${domain}`;
}
