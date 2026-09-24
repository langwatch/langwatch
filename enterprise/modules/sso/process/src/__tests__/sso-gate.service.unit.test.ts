import { createApiFixture } from "@langwatch/api-fixture";
import {
  type LicensingApi,
  type PlatformLicenseAccess,
} from "@langwatch/enterprise-licensing-contract";
import type { SsoConfiguration } from "@langwatch/enterprise-sso-contract";
import * as BetterAuthSsoAdapter from "@langwatch/enterprise-sso-contract/sign-in-providers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SsoGateLogger } from "../app/sso.members.ts";
import { SsoGateService, SsoProviderMountInspector } from "../services/sso-gate.service.ts";

class FakeLogger implements SsoGateLogger {
  readonly info = vi.fn<SsoGateLogger["info"]>();
  readonly warn = vi.fn<SsoGateLogger["warn"]>();
}

class FakeProviderMountInspector extends SsoProviderMountInspector {
  isMounted(configuration: SsoConfiguration): boolean {
    return (
      Object.keys(BetterAuthSsoAdapter.buildSocialProviders(configuration)).length > 0 ||
      BetterAuthSsoAdapter.buildGenericOAuthConfigs(configuration).length > 0
    );
  }
}

const baseConfiguration = (): SsoConfiguration => ({
  isSaas: false,
  provider: "auth0",
  baseUrl: "https://acme.test",
  auth0ClientId: "client",
  auth0ClientSecret: "secret",
  auth0Issuer: "https://acme.auth0.com",
});

const validAccess = (
  input: {
    source?: "instance" | "organization";
    organizationId?: string;
    expired?: boolean;
  } = {},
): PlatformLicenseAccess => ({
  allowed: true,
  inspections: [
    {
      source: input.source ?? "organization",
      organizationId: input.organizationId ?? "org_1",
      valid: true,
      expiresAt: input.expired ? "2000-01-01T00:00:00Z" : "2099-01-01T00:00:00Z",
      organizationName: "Acme",
      expired: input.expired ?? false,
    },
  ],
});

describe("SsoGateService", () => {
  let licensing: LicensingApi;
  const inspectPlatformAccess = vi.fn<() => Promise<PlatformLicenseAccess>>();
  let logger: FakeLogger;

  beforeEach(() => {
    licensing = createApiFixture<LicensingApi>({ inspectPlatformAccess });
    logger = new FakeLogger();
    inspectPlatformAccess.mockResolvedValue({
      allowed: false,
      inspections: [],
    });
  });

  const create = (
    configuration: SsoConfiguration = baseConfiguration(),
    evaluationTimeoutMs?: number,
  ) =>
    SsoGateService.create({
      configuration,
      licensing,
      logger,
      providerMountInspector: new FakeProviderMountInspector(),
      evaluationTimeoutMs,
    });

  /** @scenario "SaaS is unaffected by license gating" */
  it("allows SaaS without asking the licensing service", async () => {
    expect(await create({ ...baseConfiguration(), isSaas: true }).platformAllowed()).toBe(true);
    expect(inspectPlatformAccess).not.toHaveBeenCalled();
  });

  /** @scenario "An expired but genuine license still keeps SSO working" */
  it("allows any signature-valid organization license even when expired", async () => {
    inspectPlatformAccess.mockResolvedValue(validAccess({ expired: true }));

    expect(await create().platformAllowed()).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        expiresAt: "2000-01-01T00:00:00Z",
      }),
      expect.stringContaining("renewal reminder"),
    );
  });

  /** @scenario "A signed license enables a mounted provider" */
  it("resolves the configured provider once the licensing service reports genuine access", async () => {
    inspectPlatformAccess.mockResolvedValue(validAccess());

    await expect(create().resolveProvider()).resolves.toBe("auth0");
  });

  /** @scenario "Denied SSO is explained in the server logs" */
  it("logs that SSO is configured but no genuine license was found", async () => {
    await create().platformAllowed();

    expect(logger.warn).toHaveBeenCalledWith(
      {},
      expect.stringContaining("SSO is configured but no genuine license was found"),
    );
  });

  /** @scenario "A tampered license does not enable SSO" */
  it("rejects a tampered license and explains the failed signature", async () => {
    inspectPlatformAccess.mockResolvedValue({
      allowed: false,
      inspections: [
        {
          source: "organization",
          organizationId: "org_1",
          valid: false,
          reason: "invalid_signature",
        },
      ],
    });

    expect(await create().platformAllowed()).toBe(false);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", signatureOk: false }),
      expect.stringContaining("signature failed"),
    );
  });

  /** @scenario "An SSO-only deployment recovers by setting the instance license key" */
  it("asks licensing, which holds the instance license, and admits what it grants", async () => {
    inspectPlatformAccess.mockResolvedValue(
      validAccess({ source: "instance", organizationId: undefined }),
    );

    expect(await create(baseConfiguration()).platformAllowed()).toBe(true);
    expect(inspectPlatformAccess).toHaveBeenCalledWith();
  });

  /** @scenario "Self-hosted with a genuine org license keeps SSO working with zero action" */
  it("shares one successful process decision across concurrent requests", async () => {
    let settle: (access: PlatformLicenseAccess) => void = () => {};
    inspectPlatformAccess.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const service = create();

    const first = service.platformAllowed();
    const second = service.platformAllowed();
    settle(validAccess());

    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(inspectPlatformAccess).toHaveBeenCalledOnce();
  });

  /** @scenario "A licensing-store outage refuses SSO and heals itself" */
  /** @scenario "A failed license-store evaluation is retried" */
  it("evicts a failed licensing decision so the next request self-heals", async () => {
    inspectPlatformAccess
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(validAccess());
    const service = create();

    expect(await service.platformAllowed()).toBe(false);
    expect(await service.platformAllowed()).toBe(true);
    expect(inspectPlatformAccess).toHaveBeenCalledTimes(2);
  });

  /** @scenario "A licensing store that never answers stops being waited on" */
  it("times out a stuck licensing service and retries later", async () => {
    vi.useFakeTimers();
    try {
      inspectPlatformAccess
        .mockReturnValueOnce(new Promise(() => {}))
        .mockResolvedValueOnce(validAccess());
      const service = create(baseConfiguration(), 50);
      const first = service.platformAllowed();
      await vi.advanceTimersByTimeAsync(50);

      expect(await first).toBe(false);
      expect(await service.platformAllowed()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  /** @scenario "A provider id this build cannot mount falls back to email" */
  /** @scenario "A provider without credentials falls back to email" */
  it("falls back to email when a licensed provider cannot mount", async () => {
    inspectPlatformAccess.mockResolvedValue(
      validAccess({ source: "instance", organizationId: undefined }),
    );
    const configuration = {
      ...baseConfiguration(),
      auth0ClientSecret: undefined,
    };
    expect(await create(configuration).resolveProvider()).toBe("email");
    expect(logger.warn).toHaveBeenCalledWith(
      { provider: "auth0" },
      expect.stringContaining("cannot mount"),
    );
  });

  /** Every plain OIDC provider rides the same gate as auth0: with no genuine
   *  license the deployment reports email, so the sign-in page never offers
   *  federation and the provider is not reachable.
   *  @scenario "Without a license the provider is not offered" */
  it.each(["cognito", "onelogin", "oidc"] as const)(
    "reports email rather than %s when nothing licenses federation",
    async (provider) => {
      const service = create({
        ...baseConfiguration(),
        provider,
        auth0ClientId: "client",
        auth0ClientSecret: "secret",
        auth0Issuer: "https://acme.example.com",
      });

      expect(await service.platformAllowed()).toBe(false);
      expect(await service.resolveProvider()).toBe("email");
    },
  );
});
