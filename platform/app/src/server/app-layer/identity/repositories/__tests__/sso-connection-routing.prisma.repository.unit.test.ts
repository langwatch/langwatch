import { describe, expect, it } from "vitest";
import type {
  SsoConnection,
  SsoConnectionMigrationPhase,
} from "~/generated/prisma/client";
import { verifiedDomainCanBeShared } from "../sso-connection-projection.prisma.repository";
import { selectMigrationRoute } from "../sso-connection-routing.prisma.repository";

function connection({
  id,
  replacesConnectionId = null,
  migrationPhase = null,
  updatedAt = new Date("2026-01-01T00:00:00.000Z"),
}: {
  id: string;
  replacesConnectionId?: string | null;
  migrationPhase?: SsoConnectionMigrationPhase | null;
  updatedAt?: Date;
}): SsoConnection {
  const occurredAt = new Date("2026-01-01T00:00:00.000Z");
  return {
    id,
    organizationId: "org_acme",
    type: "oidc",
    state: "ACTIVE",
    claimedDomains: [],
    domainClaims: [],
    approvedDomains: [],
    verifiedDomains: ["acme.com"],
    lapsedDomains: [],
    domainVerifications: [],
    pendingVerification: null,
    idpMetadata: {},
    arrivalPolicy: "admit",
    allowsJit: true,
    arrivalPolicyDecidedAt: occurredAt,
    source:
      replacesConnectionId === null ? "legacy-grandfathered" : "self-serve",
    testLoginAccountId: null,
    replacesConnectionId,
    migrationPhase,
    graceStartedAt: null,
    routeChangedAt: null,
    finalizationRequestedAt: null,
    finalizedAt: null,
    rejection: null,
    createdBy: "user_owner",
    tearDownAfter: null,
    occurredAt,
    lastEventId: `event_${id}`,
    acceptedAt: occurredAt,
    projectionVersion: "1",
    createdAt: occurredAt,
    updatedAt,
  };
}

const legacy = connection({ id: "connection_legacy" });

function replacement(
  migrationPhase: SsoConnectionMigrationPhase,
  updatedAt?: Date,
): SsoConnection {
  return connection({
    id: "connection_direct",
    replacesConnectionId: legacy.id,
    migrationPhase,
    updatedAt,
  });
}

describe("persisted SSO migration routing", () => {
  it.each([
    "SETUP",
    "GRACE_LEGACY",
  ] as const)("keeps the grandfathered connection selected during %s", (migrationPhase) => {
    expect(
      selectMigrationRoute([legacy, replacement(migrationPhase)], "normal")?.id,
    ).toBe(legacy.id);
  });

  it.each([
    "GRACE_DIRECT",
    "FINALIZING",
    "FINALIZED",
  ] as const)("selects the direct replacement during %s", (migrationPhase) => {
    expect(
      selectMigrationRoute([legacy, replacement(migrationPhase)], "normal")?.id,
    ).toBe("connection_direct");
  });

  it("selects the replacement explicitly for a setup test", () => {
    expect(
      selectMigrationRoute([legacy, replacement("SETUP")], "replacement")?.id,
    ).toBe("connection_direct");
  });

  it("does not let projection update order change the selected route", () => {
    const newerLegacy = connection({
      id: legacy.id,
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    const olderDirect = replacement(
      "GRACE_DIRECT",
      new Date("2026-02-01T00:00:00.000Z"),
    );

    expect(selectMigrationRoute([olderDirect, newerLegacy], "normal")?.id).toBe(
      olderDirect.id,
    );
  });

  it("refuses unrelated holders instead of choosing by row order", () => {
    const unrelated = connection({ id: "connection_unrelated" });

    expect(() =>
      selectMigrationRoute([legacy, unrelated], "normal"),
    ).toThrowError("sso_domain_holders_are_not_a_replacement_pair");
  });
});

describe("verified domain holders", () => {
  const grandfathered = {
    id: "connection_legacy",
    organizationId: "org_acme",
    replacesConnectionId: null,
  };

  it("allows only the exact direct replacement in the same organization", () => {
    expect(
      verifiedDomainCanBeShared({
        existing: grandfathered,
        incoming: {
          id: "connection_direct",
          organizationId: "org_acme",
          replacesConnectionId: grandfathered.id,
        },
      }),
    ).toBe(true);
  });

  it("refuses an unrelated third connection", () => {
    expect(
      verifiedDomainCanBeShared({
        existing: grandfathered,
        incoming: {
          id: "connection_third",
          organizationId: "org_acme",
          replacesConnectionId: null,
        },
      }),
    ).toBe(false);
  });

  it("refuses a cross-organization replacement claim", () => {
    expect(
      verifiedDomainCanBeShared({
        existing: grandfathered,
        incoming: {
          id: "connection_foreign",
          organizationId: "org_other",
          replacesConnectionId: grandfathered.id,
        },
      }),
    ).toBe(false);
  });
});
