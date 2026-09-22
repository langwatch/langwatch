/**
 * @vitest-environment node
 * What a connection's stored state is allowed to prove about a domain, and
 * what it may never be read as proving.
 */
import { describe, expect, it } from "vitest";

import {
  emptySsoConnection,
  type SsoConnectionState,
  type SsoDomainVerification,
} from "../connection.ts";
import {
  isConfiguredLegacySsoRoute,
  isSsoConnectionInSetup,
  lapsedDomainsOf,
  looksLikeSsoConnectionId,
  qualifySsoDomainOwnership,
  ssoDomainStanding,
} from "../sso-domain-ownership.ts";

const DOMAIN = "acme.com";
const ORGANIZATION_ID = "org_acme";

function proof(overrides: Partial<SsoDomainVerification> = {}): SsoDomainVerification {
  return {
    domain: DOMAIN,
    method: "dns-txt",
    actorId: null,
    verifiedAtMs: 1_756_000_000_000,
    proofState: "VERIFIED",
    firstAbsentAtMs: null,
    graceEndsAtMs: null,
    tokenHash: "sha256:published-proof",
    ...overrides,
  };
}

function stateWith(
  entry?: SsoDomainVerification,
  over: Partial<SsoConnectionState> = {},
): SsoConnectionState {
  return {
    ...emptySsoConnection({ connectionId: "ssoc_test" }),
    organizationId: ORGANIZATION_ID,
    verifiedDomains: [DOMAIN],
    domainVerifications: entry ? [entry] : [],
    ...over,
  };
}

describe("qualifying what proved a domain", () => {
  it("treats a bare verified-domain array as evidence of nothing", () => {
    expect(qualifySsoDomainOwnership({ state: stateWith(), domain: DOMAIN })).toEqual({
      status: "UNKNOWN",
      reason: "absent",
    });
  });

  it("answers absent for a domain the connection never carried", () => {
    expect(
      qualifySsoDomainOwnership({ state: stateWith(proof()), domain: "elsewhere.com" }),
    ).toEqual({ status: "UNKNOWN", reason: "absent" });
  });

  it.each(["dns-txt", "https-file"] as const)(
    "accepts a live %s proof that kept the hash it compared against",
    (method) => {
      expect(
        qualifySsoDomainOwnership({ state: stateWith(proof({ method })), domain: DOMAIN }).status,
      ).toBe("QUALIFIED");
    },
  );

  it("refuses a published proof whose hash is gone, rather than inferring it back", () => {
    expect(
      qualifySsoDomainOwnership({ state: stateWith(proof({ tokenHash: null })), domain: DOMAIN }),
    ).toEqual({ status: "UNKNOWN", reason: "incomplete" });
  });

  it("refuses a proof with no time on it", () => {
    expect(
      qualifySsoDomainOwnership({ state: stateWith(proof({ verifiedAtMs: 0 })), domain: DOMAIN }),
    ).toEqual({ status: "UNKNOWN", reason: "incomplete" });
  });

  it("treats a licence token as installation evidence, not domain proof", () => {
    expect(
      qualifySsoDomainOwnership({
        state: stateWith(proof({ method: "license-token", tokenHash: null })),
        domain: DOMAIN,
      }),
    ).toEqual({ status: "UNKNOWN", reason: "inferred" });
  });

  it("requires an attestation to name the operator who made it", () => {
    const attested = proof({
      method: "operator-attested",
      actorId: "user_operator",
      tokenHash: null,
    });

    expect(qualifySsoDomainOwnership({ state: stateWith(attested), domain: DOMAIN }).status).toBe(
      "QUALIFIED",
    );
    expect(
      qualifySsoDomainOwnership({
        state: stateWith({ ...attested, actorId: null }),
        domain: DOMAIN,
      }),
    ).toEqual({ status: "UNKNOWN", reason: "incomplete" });
  });

  it("accepts a grandfathered import only on a grandfathered connection, written by nobody", () => {
    const imported = proof({ method: "legacy-configuration", actorId: null, tokenHash: null });
    const legacy = { source: "legacy-grandfathered" as const };

    expect(
      qualifySsoDomainOwnership({ state: stateWith(imported, legacy), domain: DOMAIN }).status,
    ).toBe("QUALIFIED");
    expect(qualifySsoDomainOwnership({ state: stateWith(imported), domain: DOMAIN })).toEqual({
      status: "UNKNOWN",
      reason: "incomplete",
    });
    expect(
      qualifySsoDomainOwnership({
        state: stateWith({ ...imported, actorId: "user_operator" }, legacy),
        domain: DOMAIN,
      }),
    ).toEqual({ status: "UNKNOWN", reason: "incomplete" });
  });

  it("refuses a lapsed proof without erasing the evidence it had", () => {
    const lapsed = proof({ proofState: "LAPSED", firstAbsentAtMs: 1_756_100_000_000 });

    expect(qualifySsoDomainOwnership({ state: stateWith(lapsed), domain: DOMAIN })).toEqual({
      status: "LAPSED",
      proof: lapsed,
    });
  });
});

describe("reading a connection's standing on one domain", () => {
  it("separates being live from having proved, so a lapse routes and admits nobody", () => {
    const lapsed = proof({ proofState: "LAPSED" });

    expect(
      ssoDomainStanding({ connection: stateWith(lapsed, { state: "ACTIVE" }), domain: DOMAIN }),
    ).toEqual({ live: true, proved: false, lapsed: true });
    expect(lapsedDomainsOf(stateWith(lapsed))).toEqual([DOMAIN]);
  });

  it("answers live and proved for a connection that is on", () => {
    expect(
      ssoDomainStanding({ connection: stateWith(proof(), { state: "ACTIVE" }), domain: DOMAIN }),
    ).toEqual({ live: true, proved: true, lapsed: false });
  });
});

describe("telling one connection identifier or state from another", () => {
  it("recognises a connection identifier with or without its environment prefix", () => {
    expect(looksLikeSsoConnectionId("ssoc_0005NmMMMX8uk3JfupN0JsNdW368m")).toBe(true);
    expect(looksLikeSsoConnectionId("local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m")).toBe(true);
    expect(looksLikeSsoConnectionId("ssocmd_0005NmMMMX8uk3JfupN0JsNdW368m")).toBe(false);
    expect(looksLikeSsoConnectionId("google")).toBe(false);
  });

  it("names the five states a setup passes through, and nothing later", () => {
    for (const state of ["DRAFT", "CLAIMED", "APPROVED", "VERIFICATION_PENDING", "VERIFIED"]) {
      expect(isSsoConnectionInSetup(state)).toBe(true);
    }
    for (const state of ["ACTIVE", "SUSPENDED", "TEARDOWN_PENDING", "TORN_DOWN", "REJECTED"]) {
      expect(isSsoConnectionInSetup(state)).toBe(false);
    }
  });

  it("calls only a grandfathered connection with a provider the compatibility route", () => {
    expect(
      isConfiguredLegacySsoRoute({ source: "legacy-grandfathered", providerId: "auth0" }),
    ).toBe(true);
    expect(isConfiguredLegacySsoRoute({ source: "legacy-grandfathered", providerId: "" })).toBe(
      false,
    );
    expect(isConfiguredLegacySsoRoute({ source: "self-serve", providerId: "okta" })).toBe(false);
  });
});
