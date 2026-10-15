/**
 * @vitest-environment node
 * Which connection speaks for a domain, and which legacy pin names a brokered subject.
 * Spec: specs/identity/sso-brokered-saml-address.feature
 */
import { emptySsoConnection, type SsoConnectionState } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { admitsAssertedDomain, pinsBrokeredSubject } from "../sso-brokered-address.rules.ts";

function legacyRoute(over: Partial<SsoConnectionState> = {}): SsoConnectionState {
  const base = emptySsoConnection({ connectionId: "ssoc_gf_org_acme" });
  return {
    ...base,
    organizationId: "org_acme",
    state: "ACTIVE",
    source: "legacy-grandfathered",
    verifiedDomains: ["acme.com"],
    idpMetadata: { ...base.idpMetadata, providerId: "samlp|acme" },
    ...over,
  };
}

describe("admitsAssertedDomain", () => {
  /** @scenario "A brokered SAML address on the pinning organization's proved domain is verified" */
  it("admits a legacy route's imported domain, as the sign-in gate does", () => {
    expect(admitsAssertedDomain({ connection: legacyRoute(), domain: "acme.com" })).toBe(true);
  });

  /** @scenario "A brokered SAML address on a domain nobody proved is not verified" */
  it("refuses a domain the connection does not hold, and a self-serve one it never proved", () => {
    expect(admitsAssertedDomain({ connection: legacyRoute(), domain: "acme.io" })).toBe(false);
    const unproved = legacyRoute({ source: "self-serve", domainVerifications: [] });
    expect(admitsAssertedDomain({ connection: unproved, domain: "acme.com" })).toBe(false);
  });
});

describe("pinsBrokeredSubject", () => {
  /** @scenario "A brokered SAML address on the pinning organization's proved domain is verified" */
  it("matches a subject under the pinned connection", () => {
    expect(pinsBrokeredSubject({ connection: legacyRoute(), subject: "samlp|acme|alice" })).toBe(
      true,
    );
  });

  /** @scenario "A brokered SAML subject from a connection the organization does not pin is not verified" */
  it.each(["samlp|acme", "samlp|acme-two|alice", "samlp|acmex|alice", "auth0|samlp|acme|x"])(
    "does not match %s",
    (subject) => {
      expect(pinsBrokeredSubject({ connection: legacyRoute(), subject })).toBe(false);
    },
  );

  /** @scenario "A pin naming only the broker or the SAML strategy verifies nobody" */
  it.each(["auth0", "samlp", ""])("never matches under a pin of %j", (pin) => {
    const connection = legacyRoute({
      idpMetadata: { ...legacyRoute().idpMetadata, providerId: pin },
    });
    expect(pinsBrokeredSubject({ connection, subject: "samlp|acme|alice" })).toBe(false);
  });

  /** @scenario "A lapsed domain proof or a legacy route that is no longer live verifies nobody" */
  it("never matches a route that is not live or not a legacy route", () => {
    const suspended = legacyRoute({ state: "SUSPENDED" });
    const selfServe = legacyRoute({ source: "self-serve" });
    expect(pinsBrokeredSubject({ connection: suspended, subject: "samlp|acme|a" })).toBe(false);
    expect(pinsBrokeredSubject({ connection: selfServe, subject: "samlp|acme|a" })).toBe(false);
  });
});
