/**
 * The setup read translated into what each section wants, where the
 * translation is the only place a qualification can quietly become a state.
 */
import type { SsoSetupPageView } from "@langwatch/enterprise-sso-contract";
import { describe, expect, it } from "vitest";

import {
  domainClaimsOf,
  domainEvidenceOf,
  goLiveFactsOf,
  provesWithLicense,
} from "../setup-view.ts";

type Connection = NonNullable<SsoSetupPageView["connection"]>;

function proof(overrides: Partial<Connection["domainProofs"][number]> = {}) {
  return {
    domain: "acme.com",
    method: "dns-txt" as const,
    qualification: "QUALIFIED" as const,
    proofState: "VERIFIED" as const,
    graceEndsAtMs: null,
    verifiedAtMs: 1_764_000_000_000,
    verifier: { type: "user" as const, id: "user_ana" },
    ...overrides,
  };
}

function connection(proofs: Connection["domainProofs"]): Connection {
  return {
    connectionId: "ssoc_1",
    state: "ACTIVE",
    type: "oidc",
    providerId: "Okta",
    issuer: null,
    source: "self-serve",
    arrivalPolicy: "admit",
    arrivalPolicyDecidedAtMs: null,
    tearDownAfterMs: null,
    createdAtMs: 1_764_000_000_000,
    verifiedDomains: proofs.map((entry) => entry.domain),
    domainProofs: proofs,
  };
}

describe("the evidence behind each domain", () => {
  it("reads proved off the qualification, so a lapsed record stops vouching", () => {
    const evidence = domainEvidenceOf(
      connection([
        proof(),
        proof({
          domain: "lapsed.com",
          qualification: "LAPSED",
          proofState: "WAVERING",
          graceEndsAtMs: 1_764_600_000_000,
        }),
      ]),
    );

    expect(evidence).toEqual([
      { domain: "acme.com", proved: true, proofState: "VERIFIED", graceEndsAtMs: null },
      {
        domain: "lapsed.com",
        proved: false,
        proofState: "WAVERING",
        graceEndsAtMs: 1_764_600_000_000,
      },
    ]);
  });
});

describe("the domains put forward and not proved", () => {
  it("calls a claim nobody has looked at waiting, and keeps what a reviewer wrote", () => {
    expect(
      domainClaimsOf([
        { domain: "acme.com", state: "CLAIMED", note: null, waitsForReview: true },
        { domain: "other.com", state: "REJECTED", note: "Not yours", waitsForReview: false },
      ]),
    ).toEqual([
      { domain: "acme.com", state: "WAITING", note: null, waitsForReview: true },
      { domain: "other.com", state: "REJECTED", note: "Not yours", waitsForReview: false },
    ]);
  });
});

describe("whether this installation proves with its licence", () => {
  it("says so while the ceremony in flight is the licensed one", () => {
    expect(
      provesWithLicense({
        connection: connection([]),
        record: { domain: "acme.com", method: "license-token", expiresAtMs: null, expired: false },
      }),
    ).toBe(true);
  });

  it("says so where a domain was already proved that way", () => {
    expect(
      provesWithLicense({
        connection: connection([proof({ method: "license-token" })]),
        record: null,
      }),
    ).toBe(true);
  });

  /** A record to publish is what a DNS ceremony has and a licensed one never does. */
  it("says no while nothing names the licence, so nobody is sent to publish nothing", () => {
    expect(provesWithLicense({ connection: connection([proof()]), record: null })).toBe(false);
    expect(provesWithLicense({ connection: null, record: null })).toBe(false);
  });
});

describe("the facts the last step reads", () => {
  it("reads each one off the journey the read answered", () => {
    expect(
      goLiveFactsOf({
        domainProved: true,
        testSignIn: { done: true },
        breakGlass: { inPlace: true, liveCount: 2 },
        arrivalsDecided: true,
        ready: true,
        activated: true,
      }),
    ).toEqual({
      domainProved: true,
      testSignInDone: true,
      breakGlassInPlace: true,
      arrivalsDecided: true,
      activated: true,
    });
  });

  /** Nothing done is what an unread journey looks like — never "on". */
  it("says nothing is done where the read answered no journey at all", () => {
    expect(goLiveFactsOf(null)).toEqual({
      domainProved: false,
      testSignInDone: false,
      breakGlassInPlace: false,
      arrivalsDecided: false,
      activated: false,
    });
  });
});
