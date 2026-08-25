import { describe, expect, it } from "vitest";
import {
  disputedDomainClaimQueue,
  domainClaimRetryAfterSeconds,
  emptySsoConnection,
  isClaimableSsoDomain,
  SSO_DOMAIN_CLAIM_WINDOW_MS,
  SSO_DOMAIN_CLAIMS_PER_WINDOW,
  type SsoConnectionState,
  type SsoDomainClaim,
} from "../index";

/**
 * The rails a domain claim runs between, and the queue that is left once a
 * published record decides the rest.
 *
 * Pure, so every branch is enumerable without a stub: what a claimable domain
 * is, when the window is full, and which waiting claims are actually a
 * person's to decide.
 */

const T0 = 1_756_000_000_000;
const HOUR_MS = 60 * 60 * 1000;

const claimAt = ({
  domain,
  claimedAtMs,
}: {
  domain: string;
  claimedAtMs: number;
}): SsoDomainClaim => ({
  domain,
  state: "WAITING",
  claimedAtMs,
  claimedByActorId: "user_ana",
  decidedAtMs: null,
  decidedByActorId: null,
  authority: null,
  waitedMs: null,
  note: null,
});

const waiting = ({
  connectionId,
  organizationId,
  domain,
  claimedAtMs,
}: {
  connectionId: string;
  organizationId: string;
  domain: string;
  claimedAtMs: number;
}): SsoConnectionState => ({
  ...emptySsoConnection({ connectionId }),
  organizationId,
  state: "CLAIMED",
  claimedDomains: [domain],
  domainClaims: [claimAt({ domain, claimedAtMs })],
});

describe("what a domain claim may be", () => {
  describe("when the domain is one a company owns", () => {
    it("accepts a company domain and a subdomain of one", () => {
      expect(isClaimableSsoDomain("acme.com")).toBe(true);
      expect(isClaimableSsoDomain("mail.acme.com")).toBe(true);
      expect(isClaimableSsoDomain("acme.co.uk")).toBe(true);
    });
  });

  describe("when the domain is one nobody could own alone", () => {
    it("refuses shared mail providers, registry suffixes and bare labels", () => {
      for (const domain of [
        "gmail.com",
        "outlook.com",
        "proton.me",
        "co.uk",
        "com.au",
        "com",
        "localhost",
        "",
      ]) {
        expect(isClaimableSsoDomain(domain)).toBe(false);
      }
    });

    it("reads a domain in whatever case it was typed", () => {
      expect(isClaimableSsoDomain("GMAIL.com")).toBe(false);
      expect(isClaimableSsoDomain("  CO.UK  ")).toBe(false);
    });
  });
});

describe("how often one connection may claim", () => {
  describe("when fewer claims than the window allows were made", () => {
    it("answers no wait at all", () => {
      const claims = [
        claimAt({ domain: "one.example", claimedAtMs: T0 }),
        claimAt({ domain: "two.example", claimedAtMs: T0 + 60_000 }),
      ];

      expect(
        domainClaimRetryAfterSeconds({ claims, nowMs: T0 + 120_000 }),
      ).toBe(0);
    });
  });

  describe("when the window is full", () => {
    it("answers the wait until the oldest claim leaves the window", () => {
      const claims = Array.from(
        { length: SSO_DOMAIN_CLAIMS_PER_WINDOW },
        (_unused, index) =>
          claimAt({ domain: `d${index}.example`, claimedAtMs: T0 + index }),
      );

      // Ten minutes in, fifty of the hour are left — counted from the oldest
      // claim still inside the window rather than from the newest.
      expect(
        domainClaimRetryAfterSeconds({ claims, nowMs: T0 + 10 * 60_000 }),
      ).toBe(50 * 60);
    });

    it("lets the next claim through once the window has moved past them", () => {
      const claims = Array.from(
        { length: SSO_DOMAIN_CLAIMS_PER_WINDOW },
        (_unused, index) =>
          claimAt({ domain: `d${index}.example`, claimedAtMs: T0 + index }),
      );

      expect(
        domainClaimRetryAfterSeconds({
          claims,
          nowMs: T0 + SSO_DOMAIN_CLAIM_WINDOW_MS + 1_000,
        }),
      ).toBe(0);
    });
  });
});

describe("the claims that still need a person", () => {
  describe("when one claim is contested and another is not", () => {
    /** @scenario "The operator queue lists disputes and nothing else" */
    it("lists only the contested one, and names who already holds the domain", () => {
      const connections = [
        waiting({
          connectionId: "ssoc_acme",
          organizationId: "org_acme",
          domain: "acme.com",
          claimedAtMs: T0,
        }),
        waiting({
          connectionId: "ssoc_beta",
          organizationId: "org_beta",
          domain: "beta.example",
          claimedAtMs: T0 + HOUR_MS,
        }),
      ];

      const queue = disputedDomainClaimQueue({
        connections,
        nowMs: T0 + 2 * HOUR_MS,
        verifiedElsewhere: new Map([["acme.com", "org_first"]]),
      });

      expect(queue).toEqual([
        expect.objectContaining({
          domain: "acme.com",
          organizationId: "org_acme",
          disputedWithOrganizationId: "org_first",
          waitedMs: 2 * HOUR_MS,
        }),
      ]);
    });
  });

  describe("when the organization that holds the domain is the claimant", () => {
    it("lists nothing, because nobody is disputing anything", () => {
      const connections = [
        waiting({
          connectionId: "ssoc_acme",
          organizationId: "org_acme",
          domain: "acme.com",
          claimedAtMs: T0,
        }),
      ];

      expect(
        disputedDomainClaimQueue({
          connections,
          nowMs: T0 + HOUR_MS,
          verifiedElsewhere: new Map([["acme.com", "org_acme"]]),
        }),
      ).toEqual([]);
    });
  });
});
