import type { PlanInfo } from "@langwatch/entitlement-contract";
import {
  LicensingService,
  type LicenseStatus,
  type PlatformLicenseAccess,
  type RemoveLicenseResult,
  type StoreLicenseResult,
} from "@langwatch/enterprise-licensing-contract";
import type { SsoConfiguration } from "@langwatch/enterprise-sso-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetterAuthSsoAdapter } from "../src/adapters/better-auth.better-auth.adapter";
import {
  SsoGateLogger,
  SsoGateService,
  SsoProviderMountInspector,
} from "../src/services/sso-gate.service";

class FakeLicensingService extends LicensingService {
  readonly inspectPlatformAccess = vi.fn<
    (input: {
      instanceLicenseKey?: string | undefined;
    }) => Promise<PlatformLicenseAccess>
  >();

  getActivePlan(): Promise<PlanInfo> {
    return Promise.reject(new Error("unused"));
  }
  getSelfHostedPlan(): Promise<PlanInfo> {
    return Promise.reject(new Error("unused"));
  }
  validateAndStoreLicense(): Promise<StoreLicenseResult> {
    return Promise.reject(new Error("unused"));
  }
  getLicenseStatus(): Promise<LicenseStatus> {
    return Promise.reject(new Error("unused"));
  }
  removeLicense(): Promise<RemoveLicenseResult> {
    return Promise.reject(new Error("unused"));
  }
}

class FakeLogger extends SsoGateLogger {
  readonly info = vi.fn();
  readonly warn = vi.fn();
}

class FakeProviderMountInspector extends SsoProviderMountInspector {
  isMounted(configuration: SsoConfiguration): boolean {
    return (
      Object.keys(BetterAuthSsoAdapter.buildSocialProviders(configuration))
        .length > 0 ||
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
      expiresAt: input.expired
        ? "2000-01-01T00:00:00Z"
        : "2099-01-01T00:00:00Z",
      organizationName: "Acme",
      expired: input.expired ?? false,
    },
  ],
});

describe("SsoGateService", () => {
  let licensing: FakeLicensingService;
  let logger: FakeLogger;

  beforeEach(() => {
    licensing = new FakeLicensingService();
    logger = new FakeLogger();
    licensing.inspectPlatformAccess.mockResolvedValue({
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

  it("allows SaaS without asking the licensing service", async () => {
    expect(
      await create({ ...baseConfiguration(), isSaas: true }).platformAllowed(),
    ).toBe(true);
    expect(licensing.inspectPlatformAccess).not.toHaveBeenCalled();
  });

  it("allows any signature-valid organization license even when expired", async () => {
    licensing.inspectPlatformAccess.mockResolvedValue(
      validAccess({ expired: true }),
    );

    expect(await create().platformAllowed()).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        expiresAt: "2000-01-01T00:00:00Z",
      }),
      expect.stringContaining("renewal reminder"),
    );
  });

  it("rejects a tampered license and explains the failed signature", async () => {
    licensing.inspectPlatformAccess.mockResolvedValue({
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

  it("passes the instance license to the shared licensing service", async () => {
    licensing.inspectPlatformAccess.mockResolvedValue(
      validAccess({ source: "instance", organizationId: undefined }),
    );

    expect(
      await create({
        ...baseConfiguration(),
        instanceLicenseKey: "instance-license",
      }).platformAllowed(),
    ).toBe(true);
    expect(licensing.inspectPlatformAccess).toHaveBeenCalledWith({
      instanceLicenseKey: "instance-license",
    });
  });

  it("shares one successful process decision across concurrent requests", async () => {
    let settle: (access: PlatformLicenseAccess) => void = () => {};
    licensing.inspectPlatformAccess.mockReturnValue(
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
    expect(licensing.inspectPlatformAccess).toHaveBeenCalledOnce();
  });

  it("evicts a failed licensing decision so the next request self-heals", async () => {
    licensing.inspectPlatformAccess
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(validAccess());
    const service = create();

    expect(await service.platformAllowed()).toBe(false);
    expect(await service.platformAllowed()).toBe(true);
    expect(licensing.inspectPlatformAccess).toHaveBeenCalledTimes(2);
  });

  it("times out a stuck licensing service and retries later", async () => {
    vi.useFakeTimers();
    try {
      licensing.inspectPlatformAccess
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

  it("falls back to email when a licensed provider cannot mount", async () => {
    licensing.inspectPlatformAccess.mockResolvedValue(
      validAccess({ source: "instance", organizationId: undefined }),
    );
    const configuration = {
      ...baseConfiguration(),
      auth0ClientSecret: undefined,
      instanceLicenseKey: "instance-license",
    };
    expect(await create(configuration).resolveProvider()).toBe("email");
    expect(logger.warn).toHaveBeenCalledWith(
      { provider: "auth0" },
      expect.stringContaining("cannot mount"),
    );
  });
});
