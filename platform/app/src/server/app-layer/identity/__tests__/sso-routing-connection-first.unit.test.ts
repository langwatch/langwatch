import type { RoutableConnection } from "@langwatch/identity";
import type { SignInDomainRoutingPort } from "@langwatch/identity-server";
import { describe, expect, it, vi } from "vitest";
import { ConnectionFirstDomainRoutingRepository } from "../repositories/sso-routing-connection-first.repository";
import { ssoMethodIsConfiguredWith } from "../sso-method-configured";

/**
 * Who decides a sign-in while the two engines coexist (D09 — see
 * specs/identity/sso-idp-termination.feature).
 *
 * The property under test is the one every organization without a connection
 * depends on: it is answered by exactly what answered it before this class
 * existed. Not "something equivalent" — the same object, from the same port,
 * so a customer signing in through the provider this deployment mounts cannot
 * tell the difference.
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

describe("given an organization whose connection is live", () => {
  /** @scenario "A live connection decides the domains it proved" */
  it("lets the connection projection decide", async () => {
    const repository = new ConnectionFirstDomainRoutingRepository({
      legacy: port(legacyConnection, [legacyConnection]),
      connections: port(projectedConnection, [projectedConnection]),
    });

    expect(
      await repository.findConnectionForDomain({ domain: "acme.com" }),
    ).toBe(projectedConnection);
  });

  /** @scenario "A live connection decides the domains it proved" */
  it("counts the connection once, not once per side", async () => {
    const repository = new ConnectionFirstDomainRoutingRepository({
      legacy: port(legacyConnection, [legacyConnection]),
      connections: port(projectedConnection, [projectedConnection]),
    });

    expect(await repository.listActiveConnections()).toEqual([
      projectedConnection,
      legacyConnection,
    ]);
  });
});

describe("given a domain no connection was ever projected for", () => {
  /** @scenario "A domain no connection answers for is still decided by the legacy columns" */
  it("answers exactly what the legacy columns answered", async () => {
    const legacy = port(legacyConnection);
    const repository = new ConnectionFirstDomainRoutingRepository({
      legacy,
      connections: port(null),
    });

    expect(
      await repository.findConnectionForDomain({ domain: "acme.com" }),
    ).toBe(legacyConnection);
    expect(legacy.findConnectionForDomain).toHaveBeenCalledWith({
      domain: "acme.com",
    });
  });

  /** @scenario "A domain no connection answers for is still decided by the legacy columns" */
  it("leaves the sole-connection list to the legacy side", async () => {
    const repository = new ConnectionFirstDomainRoutingRepository({
      legacy: port(legacyConnection, [legacyConnection]),
      connections: port(null, []),
    });

    expect(await repository.listActiveConnections()).toEqual([
      legacyConnection,
    ]);
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
