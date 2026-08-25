import type { RoutableConnection } from "@langwatch/identity";
import type { SignInDomainRoutingPort } from "@langwatch/identity-server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PerOrganizationDomainRoutingRepository } from "../repositories/sso-routing-rollout.repository";
import { ssoMethodIsConfiguredWith } from "../sso-method-configured";

/**
 * Who decides a sign-in while the two engines coexist (D09 — see
 * specs/identity/sso-idp-termination.feature).
 *
 * The property under test is the one the rollout depends on: with the flag
 * off, an organization is answered by exactly what answered it before this
 * class existed. Not "something equivalent" — the same object, from the same
 * port, so a customer signing in through the provider this deployment mounts
 * cannot tell the difference.
 */

const legacyConnection: RoutableConnection = {
  connectionId: "legacy_acme",
  method: { id: "auth0", kind: "federated", connectionId: "legacy_acme" },
  state: "ACTIVE",
  configured: true,
  allowsJit: false,
};

const projectedConnection: RoutableConnection = {
  connectionId: "ssoconn_acme",
  method: { id: "okta", kind: "federated", connectionId: "ssoconn_acme" },
  state: "ACTIVE",
  configured: true,
  allowsJit: false,
};

function port(
  connection: RoutableConnection | null,
  active: readonly RoutableConnection[] = [],
): SignInDomainRoutingPort {
  return {
    findConnectionForDomain: vi.fn().mockResolvedValue(connection),
    listActiveConnections: vi.fn().mockResolvedValue(active),
  };
}

describe("given an organization with a registered connection", () => {
  let legacy: SignInDomainRoutingPort;
  let connections: SignInDomainRoutingPort;
  let enrolled: Set<string>;
  let repository: PerOrganizationDomainRoutingRepository;

  beforeEach(() => {
    legacy = port(legacyConnection, [legacyConnection]);
    connections = port(projectedConnection, [projectedConnection]);
    enrolled = new Set<string>();
    repository = new PerOrganizationDomainRoutingRepository({
      legacy,
      connections,
      routesOffConnections: async ({ organizationId }) =>
        enrolled.has(organizationId),
      organizationOf: async () => "org_acme",
    });
  });

  describe("when the routing flag is off", () => {
    /** @scenario "With the routing flag off the strings still decide sign-in" */
    it("answers exactly what the legacy columns answered", async () => {
      const decided = await repository.findConnectionForDomain({
        domain: "acme.com",
      });

      expect(decided).toBe(legacyConnection);
      expect(legacy.findConnectionForDomain).toHaveBeenCalledWith({
        domain: "acme.com",
      });
    });

    /** @scenario "With the routing flag off the strings still decide sign-in" */
    it("leaves the sole-connection list to the legacy side", async () => {
      expect(await repository.listActiveConnections()).toEqual([
        legacyConnection,
      ]);
    });
  });

  describe("when the routing flag is on for this organization", () => {
    beforeEach(() => {
      enrolled.add("org_acme");
    });

    /** @scenario "With the routing flag on for one organization only that organization moves" */
    it("lets the connection projection decide", async () => {
      expect(
        await repository.findConnectionForDomain({ domain: "acme.com" }),
      ).toBe(projectedConnection);
    });

    it("counts the connection once, not once per side", async () => {
      expect(await repository.listActiveConnections()).toEqual([
        projectedConnection,
        legacyConnection,
      ]);
    });
  });

  describe("when the routing flag is on for a different organization", () => {
    beforeEach(() => {
      enrolled.add("org_someone_else");
    });

    /** @scenario "With the routing flag on for one organization only that organization moves" */
    it("still answers this organization from the legacy columns", async () => {
      expect(
        await repository.findConnectionForDomain({ domain: "acme.com" }),
      ).toBe(legacyConnection);
    });
  });
});

describe("given a domain no connection was ever projected for", () => {
  /** @scenario "With the routing flag off the strings still decide sign-in" */
  it("falls through to the legacy columns whatever the flag says", async () => {
    const legacy = port(legacyConnection);
    const repository = new PerOrganizationDomainRoutingRepository({
      legacy,
      connections: port(null),
      routesOffConnections: async () => true,
      organizationOf: async () => "org_acme",
    });

    expect(
      await repository.findConnectionForDomain({ domain: "acme.com" }),
    ).toBe(legacyConnection);
  });
});

describe("given a deployment that mounts its own provider", () => {
  const build = ({ registered }: { registered: readonly string[] }) => {
    const engineHoldsProvider = vi
      .fn()
      .mockImplementation(async ({ connectionId }: { connectionId: string }) =>
        registered.includes(connectionId),
      );
    return {
      engineHoldsProvider,
      isConfigured: ssoMethodIsConfiguredWith({
        mountedMethodId: async () => "auth0",
        engineHoldsProvider,
      }),
    };
  };

  /** @scenario "A deployment mounting its own provider still routes exactly as before" */
  it("configures a connection naming it without consulting the engine", async () => {
    const { isConfigured, engineHoldsProvider } = build({ registered: [] });

    expect(
      await isConfigured({
        methodId: "auth0",
        connectionId: "legacy_acme",
        organizationId: "org_acme",
      }),
    ).toBe(true);
    expect(engineHoldsProvider).not.toHaveBeenCalled();
  });

  /** @scenario "A deployment with both resolves each connection to its own side" */
  /** @scenario "A connection the engine holds a provider for counts as configured" */
  /** @scenario "The deployment's own mounted provider still counts as configured" */
  it("configures a registered connection alongside it, each from its own side", async () => {
    const { isConfigured, engineHoldsProvider } = build({
      registered: ["ssoconn_acme"],
    });

    expect(
      await isConfigured({
        methodId: "auth0",
        connectionId: "legacy_acme",
        organizationId: "org_legacy",
      }),
    ).toBe(true);
    expect(
      await isConfigured({
        methodId: "okta",
        connectionId: "ssoconn_acme",
        organizationId: "org_acme",
      }),
    ).toBe(true);
    expect(engineHoldsProvider).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A connection the engine has never heard of still refuses to route" */
  it("does not configure a connection neither side knows", async () => {
    const { isConfigured } = build({ registered: [] });

    expect(
      await isConfigured({
        methodId: "okta",
        connectionId: "ssoconn_acme",
        organizationId: "org_acme",
      }),
    ).toBe(false);
  });
});

describe("given a deployment in plain email mode", () => {
  /** @scenario "A connection the engine has never heard of still refuses to route" */
  it("configures nothing the engine does not hold", async () => {
    const isConfigured = ssoMethodIsConfiguredWith({
      mountedMethodId: async () => null,
      engineHoldsProvider: async () => false,
    });

    expect(
      await isConfigured({
        methodId: "okta",
        connectionId: "ssoconn_acme",
        organizationId: "org_acme",
      }),
    ).toBe(false);
  });
});

describe("given a projected connection whose organization cannot be resolved", () => {
  it("does not let it decide", async () => {
    // A connection with no organization is a connection no flag can be
    // checked for, and the safe answer to "may this decide a sign-in" when
    // the question cannot be asked is no.
    const legacy = port(legacyConnection);
    const repository = new PerOrganizationDomainRoutingRepository({
      legacy,
      connections: port(projectedConnection),
      routesOffConnections: async () => true,
      organizationOf: async () => null,
    });

    expect(
      await repository.findConnectionForDomain({ domain: "acme.com" }),
    ).toBe(legacyConnection);
  });
});
