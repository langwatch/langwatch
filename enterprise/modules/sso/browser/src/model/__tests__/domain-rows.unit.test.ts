// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One domain appears once. A reader asking whether acme.com is done must not
 * find two acme.com rows saying different things.
 */
import { describe, expect, it } from "vitest";

import { domainRowsFor, type DomainClaimView, type DomainEvidenceView } from "../domain-rows.ts";

const proved: DomainEvidenceView = {
  domain: "acme.com",
  proved: true,
  proofState: "VERIFIED",
  graceEndsAtMs: null,
};

const waiting: DomainClaimView = {
  domain: "acme.co.uk",
  state: "WAITING",
  waitsForReview: true,
};

describe("the domains one connection shows", () => {
  it("shows a domain it has proved and a domain it has only claimed", () => {
    const rows = domainRowsFor({ evidence: [proved], claims: [waiting] });

    expect(rows.map((row) => row.domain)).toEqual(["acme.com", "acme.co.uk"]);
  });

  it("reads a claimed-but-unproved domain as unproved", () => {
    const [row] = domainRowsFor({ evidence: [], claims: [waiting] });

    expect(row).toMatchObject({ proved: false, claim: waiting });
  });

  it("keeps one row for a domain that is both claimed and proved", () => {
    const rows = domainRowsFor({
      evidence: [proved],
      claims: [{ domain: "acme.com", state: "APPROVED", waitsForReview: false }],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ proved: true, claim: { state: "APPROVED" } });
  });

  it("says nothing at all when the connection has no domains", () => {
    expect(domainRowsFor({ evidence: [], claims: [] })).toEqual([]);
  });
});
