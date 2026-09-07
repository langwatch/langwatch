import {
  attestDomainCommandDataSchema,
  emptySsoConnection,
  qualifySsoDomainOwnership,
  type SsoConnectionState,
  type SsoDomainVerification,
} from "@langwatch/identity";
import { describe, expect, it } from "vitest";

const DOMAIN = "acme.com";
const ORG = "org_acme";

function stateWith(proof?: SsoDomainVerification): SsoConnectionState {
  return {
    ...emptySsoConnection({ connectionId: "ssoc_test" }),
    organizationId: ORG,
    verifiedDomains: [DOMAIN],
    domainVerifications: proof ? [proof] : [],
  };
}

function proof(
  overrides: Partial<SsoDomainVerification> = {},
): SsoDomainVerification {
  return {
    domain: DOMAIN,
    method: "dns-txt",
    actorId: null,
    verifiedAtMs: 1_756_000_000_000,
    proofState: "VERIFIED",
    firstAbsentAtMs: null,
    graceEndsAtMs: null,
    tokenHash: "sha256:published-proof",
    verifier: { type: "system", id: "domain-proof-check" },
    evidenceRef: "sha256:published-proof",
    note: null,
    ...overrides,
  };
}

describe("SSO domain ownership proof qualification", () => {
  it("requires bounded evidence on an operator attestation", () => {
    const command = {
      tenantId: "org_acme",
      organizationId: "org_acme",
      connectionId: "ssoc_test",
      commandId: "cmd_attest",
      occurredAtMs: 1_756_000_000_000,
      actor: { type: "user", id: "user_operator" },
      source: "self-serve",
      domain: DOMAIN,
      evidenceRef: "support-case:SSO-42",
      note: "Matched the signed customer request to the domain registry.",
    };
    expect(attestDomainCommandDataSchema.safeParse(command).success).toBe(true);
    expect(
      attestDomainCommandDataSchema.safeParse({
        ...command,
        evidenceRef: "x".repeat(501),
      }).success,
    ).toBe(false);
    expect(
      attestDomainCommandDataSchema.safeParse({ ...command, note: "" }).success,
    ).toBe(false);
  });

  it("treats a bare verified-domain array as unknown", () => {
    expect(
      qualifySsoDomainOwnership({ state: stateWith(), domain: DOMAIN }),
    ).toEqual({ status: "UNKNOWN", reason: "absent" });
  });

  it("treats a license token as installation evidence, not domain proof", () => {
    expect(
      qualifySsoDomainOwnership({
        state: stateWith(proof({ method: "license-token", tokenHash: null })),
        domain: DOMAIN,
      }),
    ).toEqual({ status: "UNKNOWN", reason: "inferred" });
  });

  it("accepts only an exact grandfather-import attestation", () => {
    const imported = proof({
      method: "legacy-configuration",
      actorId: null,
      tokenHash: null,
      evidenceRef: "legacy-sso-config:org_acme:ssoc_test:acme.com",
      verifier: { type: "system", id: null },
      legacyImport: {
        migration: "sso-connection-grandfather-v1",
        version: 1,
        organizationId: ORG,
        predecessorConnectionId: "ssoc_test",
        domain: DOMAIN,
        importedAtMs: 1_756_000_000_000,
        evidenceRef: "legacy-sso-config:org_acme:ssoc_test:acme.com",
      },
    });
    expect(qualifySsoDomainOwnership({ state: stateWith(imported), domain: DOMAIN }).status).toBe(
      "QUALIFIED",
    );
    expect(
      qualifySsoDomainOwnership({
        state: stateWith({
          ...imported,
          legacyImport: { ...imported.legacyImport!, domain: "new.acme.com" },
        }),
        domain: DOMAIN,
      }),
    ).toEqual({ status: "UNKNOWN", reason: "incomplete" });
  });

  it.each(["dns-txt", "https-file"] as const)(
    "accepts a live %s proof with retained evidence and time",
    (method) => {
      expect(
        qualifySsoDomainOwnership({
          state: stateWith(proof({ method })),
          domain: DOMAIN,
        }).status,
      ).toBe("QUALIFIED");
    },
  );

  it("requires an attestation's authenticated human and bounded evidence", () => {
    const valid = proof({
      method: "operator-attested",
      actorId: "user_operator",
      tokenHash: null,
      evidenceRef: "support-case:SSO-42",
      note: "Matched the signed customer request to the domain registry.",
      verifier: { type: "user", id: "user_operator" },
    });
    expect(
      qualifySsoDomainOwnership({ state: stateWith(valid), domain: DOMAIN })
        .status,
    ).toBe("QUALIFIED");

    expect(
      qualifySsoDomainOwnership({
        state: stateWith({
          ...valid,
          verifier: { type: "system", id: null },
        }),
        domain: DOMAIN,
      }),
    ).toEqual({ status: "UNKNOWN", reason: "incomplete" });
  });

  it("refuses a lapsed proof without erasing its original evidence", () => {
    const lapsed = proof({
      proofState: "LAPSED",
      firstAbsentAtMs: 1_756_100_000_000,
    });
    expect(
      qualifySsoDomainOwnership({ state: stateWith(lapsed), domain: DOMAIN }),
    ).toEqual({ status: "LAPSED", proof: lapsed });
  });
});
