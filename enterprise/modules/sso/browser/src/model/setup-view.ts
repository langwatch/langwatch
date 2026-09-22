// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The setup read as the sections below it want it. The wire answers one
 * connection's whole journey; each section wants its own slice, and the
 * translation is here rather than in the screen so it can be read on its own.
 */
import type { SsoSetupPageView } from "@langwatch/enterprise-sso-contract";

import type { DomainClaimView, DomainEvidenceView } from "./domain-rows.ts";

type SetupConnection = NonNullable<SsoSetupPageView["connection"]>;

/**
 * What the evidence behind each proved domain says today. `proved` is the
 * QUALIFICATION, not the state: a domain whose record has gone is still
 * VERIFIED and is no longer proof of anything.
 */
export function domainEvidenceOf(connection: SetupConnection): DomainEvidenceView[] {
  return connection.domainProofs.map((proof) => ({
    domain: proof.domain,
    proved: proof.qualification === "QUALIFIED",
    proofState: proof.proofState,
    graceEndsAtMs: proof.graceEndsAtMs,
  }));
}

/** A claim waits for review only where somebody else proved the domain first. */
export function domainClaimsOf(claims: SsoSetupPageView["claims"]): DomainClaimView[] {
  return claims.map((claim) => ({
    domain: claim.domain,
    state: claim.state === "CLAIMED" ? "WAITING" : claim.state,
    waitsForReview: claim.waitsForReview,
    note: claim.note,
  }));
}

/**
 * Whether this installation proves a domain with its licence, which leaves
 * nothing to publish. Read from the evidence rather than declared: the ceremony
 * says which method it is running, and a screen that guesses DNS at a licensed
 * installation sends an administrator to publish a record nobody will check.
 */
export function provesWithLicense({
  connection,
  record,
}: {
  connection: SetupConnection | null;
  record: SsoSetupPageView["record"];
}): boolean {
  if (record?.method === "license-token") return true;

  return connection?.domainProofs.some((proof) => proof.method === "license-token") ?? false;
}

/**
 * The five facts the step states, the checklist and the last step all read.
 * A read that answered no journey at all means nothing is done yet — which is
 * what an unregistered connection's journey looks like from here anyway.
 */
export function goLiveFactsOf(goLive: SsoSetupPageView["goLive"]): {
  domainProved: boolean;
  testSignInDone: boolean;
  breakGlassInPlace: boolean;
  arrivalsDecided: boolean;
  activated: boolean;
} {
  return {
    domainProved: goLive?.domainProved ?? false,
    testSignInDone: goLive?.testSignIn.done ?? false,
    breakGlassInPlace: goLive?.breakGlass.inPlace ?? false,
    arrivalsDecided: goLive?.arrivalsDecided ?? false,
    activated: goLive?.activated ?? false,
  };
}
