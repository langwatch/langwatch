import { describe, expect, it, vi } from "vitest";

import { ssoMethodDialWith } from "../sso-method-dial.rules.ts";

describe("ssoMethodDialWith", () => {
  const dialing = ({ registered }: { registered: readonly string[] }) => {
    const engineHoldsProvider = vi
      .fn()
      .mockImplementation(async ({ connectionId }: { connectionId: string }) =>
        registered.includes(connectionId),
      );

    return {
      engineHoldsProvider,
      dialFor: ssoMethodDialWith({
        mountedMethods: async () => ["auth0"],
        engineHoldsProvider,
      }),
    };
  };

  /** @scenario "A deployment mounting its own provider still routes exactly as before" */
  it("accepts the mounted provider without consulting the engine", async () => {
    const { dialFor, engineHoldsProvider } = dialing({ registered: [] });

    await expect(
      dialFor({
        source: "legacy-grandfathered",
        methodId: "auth0",
        connectionId: "local_ssoc_acme",
      }),
    ).resolves.toBe("auth0");
    expect(engineHoldsProvider).not.toHaveBeenCalled();
  });

  /** @scenario "A deployment with both resolves each connection to its own side" */
  /** @scenario "A connection the engine holds a provider for counts as configured" */
  it("accepts a registered connection alongside the mounted provider", async () => {
    const { dialFor, engineHoldsProvider } = dialing({ registered: ["ssoc_acme"] });

    await expect(
      dialFor({
        source: "legacy-grandfathered",
        methodId: "auth0",
        connectionId: "local_ssoc_globex",
      }),
    ).resolves.toBe("auth0");
    await expect(
      dialFor({ source: "self-serve", methodId: "okta", connectionId: "ssoc_acme" }),
    ).resolves.toBe("okta");
    expect(engineHoldsProvider).toHaveBeenCalledWith({ connectionId: "ssoc_acme" });
  });

  it("answers the broker for a grandfathered pin naming an upstream behind it", async () => {
    const { dialFor, engineHoldsProvider } = dialing({ registered: [] });

    await expect(
      dialFor({
        source: "legacy-grandfathered",
        methodId: "waad|acme-connection",
        connectionId: "local_ssoc_acme",
      }),
    ).resolves.toBe("auth0");
    expect(engineHoldsProvider).not.toHaveBeenCalled();
  });

  /** @scenario "A connection the engine has never heard of still refuses to route" */
  it("refuses a connection neither side knows", async () => {
    const { dialFor } = dialing({ registered: [] });

    await expect(
      dialFor({ source: "self-serve", methodId: "okta", connectionId: "ssoc_acme" }),
    ).resolves.toBeNull();
  });

  /** @scenario "A self-serve connection naming the mounted provider is still decided by the engine" */
  it("does not read configuration out of a self-serve method name", async () => {
    const engineHoldsProvider = vi.fn().mockResolvedValue(false);
    const dialFor = ssoMethodDialWith({
      mountedMethods: async () => ["okta"],
      engineHoldsProvider,
    });

    await expect(
      dialFor({ source: "self-serve", methodId: "okta", connectionId: "ssoc_acme" }),
    ).resolves.toBeNull();
    expect(engineHoldsProvider).toHaveBeenCalledWith({ connectionId: "ssoc_acme" });
  });

  it("refuses every method in plain email mode", async () => {
    const dialFor = ssoMethodDialWith({
      mountedMethods: async () => [],
      engineHoldsProvider: async () => false,
    });

    await expect(
      dialFor({
        source: "legacy-grandfathered",
        methodId: "okta",
        connectionId: "local_ssoc_acme",
      }),
    ).resolves.toBeNull();
  });
});
