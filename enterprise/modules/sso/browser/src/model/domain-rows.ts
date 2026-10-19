// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The domains one connection's setup screen shows: everything it proved, plus
 * everything it has put forward and not proved yet. One list, because a
 * reader asking "is acme.com done?" must find acme.com in exactly one place.
 */
import type { DomainProofState } from "./domain-proof-chip.ts";

export type DomainClaimState = "WAITING" | "APPROVED" | "REJECTED";

/** A domain this connection has put forward, and where the claim stands. */
export interface DomainClaimView {
  domain: string;
  state: DomainClaimState;
  /** True only where another organization already proved the same domain. */
  waitsForReview: boolean;
  /** What a reviewer wrote back, so a second attempt starts from it. */
  note?: string | null;
}

/** What the evidence behind one domain currently says. */
export interface DomainEvidenceView {
  domain: string;
  proved: boolean;
  proofState: DomainProofState;
  /** When a wavering domain stops routing new people, if it is wavering. */
  graceEndsAtMs: number | null;
}

export interface DomainRow {
  domain: string;
  proved: boolean;
  proofState: DomainProofState;
  graceEndsAtMs: number | null;
  claim: DomainClaimView | undefined;
}

/**
 * Evidence first, claims after, each domain once. A domain with a claim and
 * no evidence yet is un-proved, which is what "VERIFIED with proved false"
 * says: the proof state only speaks about a domain that HAS been proved.
 */
export function domainRowsFor({
  evidence,
  claims,
}: {
  evidence: readonly DomainEvidenceView[];
  claims: readonly DomainClaimView[];
}): DomainRow[] {
  const claimFor = (domain: string) => claims.find((candidate) => candidate.domain === domain);
  const rows = evidence.map((entry) => ({
    domain: entry.domain,
    proved: entry.proved,
    proofState: entry.proofState,
    graceEndsAtMs: entry.graceEndsAtMs,
    claim: claimFor(entry.domain),
  }));
  const seen = new Set(rows.map((row) => row.domain));

  for (const claim of claims) {
    if (seen.has(claim.domain)) continue;
    seen.add(claim.domain);
    rows.push({
      domain: claim.domain,
      proved: false,
      proofState: "VERIFIED",
      graceEndsAtMs: null,
      claim,
    });
  }

  return rows;
}
