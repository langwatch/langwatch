import { describe, expect, it, vi } from "vitest";
import { ssoMethodIsConfiguredWith } from "../sso-method-configured";

describe("ssoMethodIsConfiguredWith", () => {
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
  /** @scenario "The deployment's own mounted provider still counts as configured" */
  it("accepts the mounted provider without consulting the connection engine", async () => {
    const { isConfigured, engineHoldsProvider } = build({ registered: [] });

    await expect(
      isConfigured({
        source: "legacy-grandfathered",
        methodId: "auth0",
        connectionId: "legacy_acme",
        organizationId: "org_acme",
      }),
    ).resolves.toBe(true);
    expect(engineHoldsProvider).not.toHaveBeenCalled();
  });

  /** @scenario "A deployment with both resolves each connection to its own side" */
  /** @scenario "A connection the engine holds a provider for counts as configured" */
  it("accepts a registered connection alongside the mounted provider", async () => {
    const { isConfigured, engineHoldsProvider } = build({
      registered: ["ssoconn_acme"],
    });

    await expect(
      isConfigured({
        source: "legacy-grandfathered",
        methodId: "auth0",
        connectionId: "legacy_acme",
        organizationId: "org_legacy",
      }),
    ).resolves.toBe(true);
    await expect(
      isConfigured({
        source: "self-serve",
        methodId: "okta",
        connectionId: "ssoconn_acme",
        organizationId: "org_acme",
      }),
    ).resolves.toBe(true);
    expect(engineHoldsProvider).toHaveBeenCalledWith({
      connectionId: "ssoconn_acme",
    });
  });

  /** @scenario "A connection the engine has never heard of still refuses to route" */
  it("rejects a connection neither side knows", async () => {
    const { isConfigured } = build({ registered: [] });

    await expect(
      isConfigured({
        source: "self-serve",
        methodId: "okta",
        connectionId: "ssoconn_acme",
        organizationId: "org_acme",
      }),
    ).resolves.toBe(false);
  });

  /** @scenario "A self-serve connection naming the mounted provider is still decided by the engine" */
  it("does not infer configuration from a self-serve method name alone", async () => {
    const engineHoldsProvider = vi.fn().mockResolvedValue(false);
    const isConfigured = ssoMethodIsConfiguredWith({
      mountedMethodId: async () => "okta",
      engineHoldsProvider,
    });

    await expect(
      isConfigured({
        source: "self-serve",
        methodId: "okta",
        connectionId: "ssoconn_acme",
        organizationId: "org_acme",
      }),
    ).resolves.toBe(false);
    expect(engineHoldsProvider).toHaveBeenCalledWith({
      connectionId: "ssoconn_acme",
    });
  });

  /** @scenario "A connection the engine has never heard of still refuses to route" */
  it("rejects all methods in plain email mode", async () => {
    const isConfigured = ssoMethodIsConfiguredWith({
      mountedMethodId: async () => null,
      engineHoldsProvider: async () => false,
    });

    await expect(
      isConfigured({
        source: "self-serve",
        methodId: "okta",
        connectionId: "ssoconn_acme",
        organizationId: "org_acme",
      }),
    ).resolves.toBe(false);
  });
});
