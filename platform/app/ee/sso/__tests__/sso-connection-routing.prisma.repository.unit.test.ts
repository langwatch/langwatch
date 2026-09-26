import { describe, expect, it, vi } from "vitest";
import type {
  PrismaClient,
  SsoConnection,
  SsoConnectionMigrationPhase,
} from "~/generated/prisma/client";
import { verifiedDomainCanBeShared } from "../sso-connection-projection.prisma.repository";
import {
  SsoConnectionDomainRoutingRepository,
  selectMigrationRoute,
} from "../sso-connection-routing.prisma.repository";
import { ssoMethodDialWith } from "../sso-method-configured";

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

/**
 * A grandfathered row carries the organization's PIN in `idpMetadata`, and a
 * pin is not always something the sign-in surface can dial. What comes out of
 * the lookup has to be.
 *
 * Spec: specs/identity/sso-idp-termination.feature
 */
describe("given a grandfathered row pinned to a provider behind the broker", () => {
  const pinned = (providerId: string): PrismaClient =>
    ({
      ssoVerifiedDomain: { findUnique: vi.fn().mockResolvedValue(null) },
      ssoConnection: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ ...legacy, idpMetadata: { providerId } }),
      },
    }) as unknown as PrismaClient;

  const routingOver = ({
    providerId,
    mountedMethodId,
  }: {
    providerId: string;
    mountedMethodId: string | null;
  }) =>
    new SsoConnectionDomainRoutingRepository(
      pinned(providerId),
      ssoMethodDialWith({
        mountedMethodId: async () => mountedMethodId,
        engineHoldsProvider: async () => false,
      }),
    );

  describe("when the router looks its domain up", () => {
    /** @scenario "An organization pinned to a provider behind the broker is sent to the broker" */
    it("hands out the broker as what the sign-in surface dials", async () => {
      const found = await routingOver({
        providerId: "waad|acme-connection",
        mountedMethodId: "auth0",
      }).findConnectionForDomain({ domain: "acme.com" });

      expect(found?.configured).toBe(true);
      expect(found?.method.id).toBe("auth0");
      expect(found?.method.connectionId).toBe(legacy.id);
      expect(found?.connectionId).toBe(legacy.id);
    });
  });

  describe("when nothing mounted here can carry the pin", () => {
    /** @scenario "An organization naming a provider this deployment does not mount is not sent nowhere" */
    it("reports it undialable rather than handing out the pin", async () => {
      const found = await routingOver({
        providerId: "azure-ad",
        mountedMethodId: "okta",
      }).findConnectionForDomain({ domain: "acme.com" });

      expect(found?.configured).toBe(false);
    });
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
