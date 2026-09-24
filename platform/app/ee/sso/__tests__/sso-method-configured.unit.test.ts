import { describe, expect, it, vi } from "vitest";
import { ssoMethodDialWith } from "../sso-method-configured";

describe("ssoMethodDialWith", () => {
  const build = ({ registered }: { registered: readonly string[] }) => {
    const engineHoldsProvider = vi
      .fn()
      .mockImplementation(async ({ connectionId }: { connectionId: string }) =>
        registered.includes(connectionId),
      );
    return {
      engineHoldsProvider,
      dialFor: ssoMethodDialWith({
        mountedMethodId: async () => "auth0",
        engineHoldsProvider,
      }),
    };
  };

  /** @scenario "A deployment mounting its own provider still routes exactly as before" */
  /** @scenario "The deployment's own mounted provider still counts as configured" */
  it("accepts the mounted provider without consulting the connection engine", async () => {
    const { dialFor, engineHoldsProvider } = build({ registered: [] });

    await expect(
      dialFor({
        source: "legacy-grandfathered",
        methodId: "auth0",
        connectionId: "legacy_acme",
        organizationId: "org_acme",
      }),
    ).resolves.toBe("auth0");
    expect(engineHoldsProvider).not.toHaveBeenCalled();
  });

  /** @scenario "A deployment with both resolves each connection to its own side" */
  /** @scenario "A connection the engine holds a provider for counts as configured" */
  it("accepts a registered connection alongside the mounted provider", async () => {
    const { dialFor, engineHoldsProvider } = build({
      registered: ["ssoconn_acme"],
    });

    await expect(
      dialFor({
        source: "legacy-grandfathered",
        methodId: "auth0",
        connectionId: "legacy_acme",
        organizationId: "org_legacy",
      }),
    ).resolves.toBe("auth0");
    await expect(
      dialFor({
        source: "self-serve",
        methodId: "okta",
        connectionId: "ssoconn_acme",
        organizationId: "org_acme",
      }),
    ).resolves.toBe("okta");
    expect(engineHoldsProvider).toHaveBeenCalledWith({
      connectionId: "ssoconn_acme",
    });
  });

  /** @scenario "An organization pinned to a provider behind the broker is sent to the broker" */
  it("answers the broker for a grandfathered pin naming an upstream behind it", async () => {
    const { dialFor, engineHoldsProvider } = build({ registered: [] });

    await expect(
      dialFor({
        source: "legacy-grandfathered",
        methodId: "waad|acme-connection",
        connectionId: "legacy_acme",
        organizationId: "org_acme",
      }),
    ).resolves.toBe("auth0");
    expect(engineHoldsProvider).not.toHaveBeenCalled();
  });

  /** @scenario "A connection the engine has never heard of still refuses to route" */
  it("rejects a connection neither side knows", async () => {
    const { dialFor } = build({ registered: [] });

    await expect(
      dialFor({
        source: "self-serve",
        methodId: "okta",
        connectionId: "ssoconn_acme",
        organizationId: "org_acme",
      }),
    ).resolves.toBeNull();
  });

  /** @scenario "A self-serve connection naming the mounted provider is still decided by the engine" */
  it("does not infer configuration from a self-serve method name alone", async () => {
    const engineHoldsProvider = vi.fn().mockResolvedValue(false);
    const dialFor = ssoMethodDialWith({
      mountedMethodId: async () => "okta",
      engineHoldsProvider,
    });

    await expect(
      dialFor({
        source: "self-serve",
        methodId: "okta",
        connectionId: "ssoconn_acme",
        organizationId: "org_acme",
      }),
    ).resolves.toBeNull();
    expect(engineHoldsProvider).toHaveBeenCalledWith({
      connectionId: "ssoconn_acme",
    });
  });

  /** @scenario "A connection the engine has never heard of still refuses to route" */
  it("rejects all methods in plain email mode", async () => {
    const dialFor = ssoMethodDialWith({
      mountedMethodId: async () => null,
      engineHoldsProvider: async () => false,
    });

    await expect(
      dialFor({
        source: "self-serve",
        methodId: "okta",
        connectionId: "ssoconn_acme",
        organizationId: "org_acme",
      }),
    ).resolves.toBeNull();
  });
});
