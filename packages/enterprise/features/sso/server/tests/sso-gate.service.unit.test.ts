import type { SsoConfiguration } from "@langwatch/enterprise-sso-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SsoGateLogger,
  SsoGateService,
  SsoLicenseRepository,
  SsoLicenseVerifier,
  SsoProviderMountInspector,
  type SsoLicenseInspection,
} from "../src/services/sso-gate.service";
import { BetterAuthSsoAdapter } from "../src/adapters/better-auth.better-auth.adapter";

class FakeRepository extends SsoLicenseRepository {
  readonly findOrganizationsWithLicense = vi.fn();
}

class FakeVerifier extends SsoLicenseVerifier {
  readonly inspect = vi.fn<(key: string) => SsoLicenseInspection>();
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

describe("SsoGateService", () => {
  let repository: FakeRepository;
  let verifier: FakeVerifier;
  let logger: FakeLogger;

  beforeEach(() => {
    repository = new FakeRepository();
    verifier = new FakeVerifier();
    logger = new FakeLogger();
    repository.findOrganizationsWithLicense.mockResolvedValue([]);
    verifier.inspect.mockReturnValue({
      valid: true,
      expiresAt: "2099-01-01T00:00:00Z",
      organizationName: "Acme",
      expired: false,
    });
  });

  const create = (
    configuration: SsoConfiguration = baseConfiguration(),
    evaluationTimeoutMs?: number,
  ) =>
    SsoGateService.create({
      configuration,
      repository,
      verifier,
      logger,
      providerMountInspector: new FakeProviderMountInspector(),
      evaluationTimeoutMs,
    });

  it("allows SaaS without reading the licensing store", async () => {
    expect(
      await create({ ...baseConfiguration(), isSaas: true }).platformAllowed(),
    ).toBe(true);
    expect(repository.findOrganizationsWithLicense).not.toHaveBeenCalled();
  });

  it("allows any signature-valid organization license even when expired", async () => {
    repository.findOrganizationsWithLicense.mockResolvedValue([
      { id: "org_1", license: "encoded" },
    ]);
    verifier.inspect.mockReturnValue({
      valid: true,
      expiresAt: "2000-01-01T00:00:00Z",
      organizationName: "Acme",
      expired: true,
    });

    expect(await create().platformAllowed()).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", expiresAt: "2000-01-01T00:00:00Z" }),
      expect.stringContaining("renewal reminder"),
    );
  });

  it("rejects a tampered license and explains the failed signature", async () => {
    repository.findOrganizationsWithLicense.mockResolvedValue([
      { id: "org_1", license: "tampered" },
    ]);
    verifier.inspect.mockReturnValue({
      valid: false,
      reason: "invalid_signature",
    });

    expect(await create().platformAllowed()).toBe(false);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1", signatureOk: false }),
      expect.stringContaining("signature failed"),
    );
  });

  it("lets an instance license bypass the store", async () => {
    expect(
      await create({
        ...baseConfiguration(),
        instanceLicenseKey: "instance-license",
      }).platformAllowed(),
    ).toBe(true);
    expect(repository.findOrganizationsWithLicense).not.toHaveBeenCalled();
  });

  it("shares one successful process decision across concurrent requests", async () => {
    let settle: (rows: Array<{ id: string; license: string }>) => void = () => {};
    repository.findOrganizationsWithLicense.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const service = create();

    const first = service.platformAllowed();
    const second = service.platformAllowed();
    settle([{ id: "org_1", license: "encoded" }]);

    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(repository.findOrganizationsWithLicense).toHaveBeenCalledOnce();
  });

  it("evicts a failed store decision so the next request self-heals", async () => {
    repository.findOrganizationsWithLicense
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([{ id: "org_1", license: "encoded" }]);
    const service = create();

    expect(await service.platformAllowed()).toBe(false);
    expect(await service.platformAllowed()).toBe(true);
    expect(repository.findOrganizationsWithLicense).toHaveBeenCalledTimes(2);
  });

  it("times out a stuck store and retries later", async () => {
    vi.useFakeTimers();
    try {
      repository.findOrganizationsWithLicense
        .mockReturnValueOnce(new Promise(() => {}))
        .mockResolvedValueOnce([{ id: "org_1", license: "encoded" }]);
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
    const configuration = { ...baseConfiguration(), auth0ClientSecret: undefined };
    configuration.instanceLicenseKey = "instance-license";
    expect(await create(configuration).resolveProvider()).toBe("email");
    expect(logger.warn).toHaveBeenCalledWith(
      { provider: "auth0" },
      expect.stringContaining("cannot mount"),
    );
  });
});
