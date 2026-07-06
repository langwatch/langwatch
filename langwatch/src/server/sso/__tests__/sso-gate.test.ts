import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("~/env.mjs", () => ({
  env: {
    IS_SAAS: false,
    NEXTAUTH_PROVIDER: "auth0",
    LANGWATCH_LICENSE_KEY: undefined as string | undefined,
  },
}));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("~/utils/logger/server", () => ({
  createLogger: () => loggerMock,
}));

vi.mock("../../../../ee/licensing/validation", () => ({
  parseLicenseKey: vi.fn(),
  verifySignature: vi.fn(),
  isExpired: vi.fn(),
}));

import { env } from "~/env.mjs";
import {
  isExpired,
  parseLicenseKey,
  verifySignature,
} from "../../../../ee/licensing/validation";
import {
  __resetSsoGateForTests,
  __setSsoLicenseRepositoryForTests,
  platformSSOAllowed,
  resolveAuthProvider,
} from "../sso-gate";
import type { ISsoLicenseRepository } from "../sso-license.repository";

const envMock = env as unknown as {
  IS_SAAS: boolean;
  NEXTAUTH_PROVIDER: string;
  LANGWATCH_LICENSE_KEY: string | undefined;
};

const genuineLicense = (
  overrides: Partial<{ expiresAt: string; organizationName: string }> = {},
) => ({
  data: {
    licenseId: "lic_1",
    version: 1,
    organizationName: "Acme",
    email: "admin@acme.test",
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
    plan: {
      type: "ENTERPRISE",
      name: "Enterprise",
      maxMembers: 100,
      maxMessagesPerMonth: 1_000_000,
      canPublish: true,
    },
    ...overrides,
  },
  signature: "sig",
});

const repoWithOrgs = (
  orgs: { id: string; license: string }[],
): ISsoLicenseRepository => ({
  findOrganizationsWithLicense: vi.fn().mockResolvedValue(orgs),
});

describe("platformSSOAllowed", () => {
  beforeEach(() => {
    __resetSsoGateForTests();
    vi.clearAllMocks();
    envMock.IS_SAAS = false;
    envMock.NEXTAUTH_PROVIDER = "auth0";
    envMock.LANGWATCH_LICENSE_KEY = undefined;
  });

  describe("given the deployment is LangWatch Cloud", () => {
    /** @scenario SaaS is unaffected by license gating */
    it("allows SSO without ever reading the licensing store", async () => {
      envMock.IS_SAAS = true;
      const repository = repoWithOrgs([]);
      __setSsoLicenseRepositoryForTests(repository);

      const allowed = await platformSSOAllowed();

      expect(allowed).toBe(true);
      expect(repository.findOrganizationsWithLicense).not.toHaveBeenCalled();
    });
  });

  describe("given at least one organization holds a genuine license", () => {
    /** @scenario Self-hosted with a genuine org license keeps SSO working with zero action */
    it("allows SSO", async () => {
      vi.mocked(parseLicenseKey).mockReturnValue(genuineLicense());
      vi.mocked(verifySignature).mockReturnValue(true);
      vi.mocked(isExpired).mockReturnValue(false);
      __setSsoLicenseRepositoryForTests(
        repoWithOrgs([{ id: "org_1", license: "encoded" }]),
      );

      const allowed = await platformSSOAllowed();

      expect(allowed).toBe(true);
    });
  });

  describe("given the only organization license is genuine but past its expiry date", () => {
    /** @scenario An expired but genuine license still keeps SSO working */
    it("still allows SSO and logs a renewal reminder naming the expired license", async () => {
      vi.mocked(parseLicenseKey).mockReturnValue(
        genuineLicense({ expiresAt: "2000-01-01T00:00:00Z" }),
      );
      vi.mocked(verifySignature).mockReturnValue(true);
      vi.mocked(isExpired).mockReturnValue(true);
      __setSsoLicenseRepositoryForTests(
        repoWithOrgs([{ id: "org_1", license: "encoded" }]),
      );

      const allowed = await platformSSOAllowed();

      expect(allowed).toBe(true);
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
          organizationName: "Acme",
          expiresAt: "2000-01-01T00:00:00Z",
        }),
        expect.stringContaining("renewal reminder"),
      );
    });
  });

  describe("given the only stored license fails signature verification", () => {
    /** @scenario A tampered license does not enable SSO */
    it("denies SSO and logs which license was inspected and why it was rejected", async () => {
      vi.mocked(parseLicenseKey).mockReturnValue(genuineLicense());
      vi.mocked(verifySignature).mockReturnValue(false);
      __setSsoLicenseRepositoryForTests(
        repoWithOrgs([{ id: "org_1", license: "encoded" }]),
      );

      const allowed = await platformSSOAllowed();

      expect(allowed).toBe(false);
      expect(loggerMock.info).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
          signatureOk: false,
        }),
        expect.stringContaining("signature failed"),
      );
    });
  });

  describe("given no organization holds a genuine license and no instance license key is set", () => {
    /** @scenario Self-hosted that never had a license hides SSO and offers email sign-in */
    it("denies SSO", async () => {
      __setSsoLicenseRepositoryForTests(repoWithOrgs([]));

      const allowed = await platformSSOAllowed();

      expect(allowed).toBe(false);
    });

    /** @scenario Denied SSO is explained in the server logs */
    it("logs that SSO is configured but no genuine license was found", async () => {
      __setSsoLicenseRepositoryForTests(repoWithOrgs([]));

      await platformSSOAllowed();

      expect(loggerMock.warn).toHaveBeenCalledWith(
        {},
        expect.stringContaining(
          "SSO is configured but no genuine license was found",
        ),
      );
    });
  });

  describe("given a genuine instance license key and no organization license in the DB", () => {
    /** @scenario An SSO-only deployment recovers by setting the instance license key */
    it("allows SSO without needing the licensing store to succeed", async () => {
      envMock.LANGWATCH_LICENSE_KEY = "encoded-instance-key";
      vi.mocked(parseLicenseKey).mockReturnValue(genuineLicense());
      vi.mocked(verifySignature).mockReturnValue(true);
      vi.mocked(isExpired).mockReturnValue(false);
      const repository = repoWithOrgs([]);
      __setSsoLicenseRepositoryForTests(repository);

      const allowed = await platformSSOAllowed();

      expect(allowed).toBe(true);
      expect(repository.findOrganizationsWithLicense).not.toHaveBeenCalled();
    });
  });

  describe("given the licensing store cannot be reached on the first sign-in attempt", () => {
    /** @scenario A licensing-store outage refuses SSO and heals itself */
    it("denies the first attempt without memoizing, then allows once the store answers", async () => {
      const findOrganizationsWithLicense = vi
        .fn()
        .mockRejectedValueOnce(new Error("connection refused"))
        .mockResolvedValueOnce([{ id: "org_1", license: "encoded" }]);
      __setSsoLicenseRepositoryForTests({ findOrganizationsWithLicense });
      vi.mocked(parseLicenseKey).mockReturnValue(genuineLicense());
      vi.mocked(verifySignature).mockReturnValue(true);
      vi.mocked(isExpired).mockReturnValue(false);

      const firstAttempt = await platformSSOAllowed();
      expect(firstAttempt).toBe(false);

      const secondAttempt = await platformSSOAllowed();

      expect(secondAttempt).toBe(true);
      expect(findOrganizationsWithLicense).toHaveBeenCalledTimes(2);
    });
  });

  describe("given the gate already resolved to deny earlier in this process", () => {
    /** @scenario Activating a license takes effect at the next restart */
    it("stays denied even after a genuine license appears in the DB, until the process restarts", async () => {
      const findOrganizationsWithLicense = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "org_1", license: "encoded" }]);
      __setSsoLicenseRepositoryForTests({ findOrganizationsWithLicense });

      const firstAttempt = await platformSSOAllowed();
      expect(firstAttempt).toBe(false);

      vi.mocked(parseLicenseKey).mockReturnValue(genuineLicense());
      vi.mocked(verifySignature).mockReturnValue(true);
      vi.mocked(isExpired).mockReturnValue(false);

      const secondAttemptSameProcess = await platformSSOAllowed();
      expect(secondAttemptSameProcess).toBe(false);
      expect(findOrganizationsWithLicense).toHaveBeenCalledTimes(1);

      // Simulate a restart: the module-level memo is cleared.
      __resetSsoGateForTests();
      __setSsoLicenseRepositoryForTests({ findOrganizationsWithLicense });

      const afterRestart = await platformSSOAllowed();
      expect(afterRestart).toBe(true);
    });
  });

  describe("given two organizations where only the first holds a genuine license", () => {
    /** @scenario One organization's genuine license enables SSO for the whole deployment */
    it("allows SSO for the whole deployment", async () => {
      vi.mocked(parseLicenseKey).mockImplementation((key) =>
        key === "org1-license" ? genuineLicense() : null,
      );
      vi.mocked(verifySignature).mockReturnValue(true);
      vi.mocked(isExpired).mockReturnValue(false);
      __setSsoLicenseRepositoryForTests(
        repoWithOrgs([
          { id: "org_1", license: "org1-license" },
          { id: "org_2", license: "org2-no-license" },
        ]),
      );

      const allowed = await platformSSOAllowed();

      expect(allowed).toBe(true);
    });
  });
});

describe("resolveAuthProvider", () => {
  beforeEach(() => {
    __resetSsoGateForTests();
    vi.clearAllMocks();
    envMock.IS_SAAS = false;
    envMock.NEXTAUTH_PROVIDER = "auth0";
    envMock.LANGWATCH_LICENSE_KEY = undefined;
  });

  describe("when the deployment is natively configured for email", () => {
    it("returns email without evaluating the gate", async () => {
      envMock.NEXTAUTH_PROVIDER = "email";
      const repository = repoWithOrgs([]);
      __setSsoLicenseRepositoryForTests(repository);

      const provider = await resolveAuthProvider();

      expect(provider).toBe("email");
      expect(repository.findOrganizationsWithLicense).not.toHaveBeenCalled();
    });
  });

  describe("when the gate denies", () => {
    /** @scenario Self-hosted that never had a license hides SSO and offers email sign-in */
    it("coerces the reported provider to email", async () => {
      __setSsoLicenseRepositoryForTests(repoWithOrgs([]));

      const provider = await resolveAuthProvider();

      expect(provider).toBe("email");
    });
  });

  describe("when the gate allows", () => {
    it("reports the configured provider", async () => {
      vi.mocked(parseLicenseKey).mockReturnValue(genuineLicense());
      vi.mocked(verifySignature).mockReturnValue(true);
      vi.mocked(isExpired).mockReturnValue(false);
      __setSsoLicenseRepositoryForTests(
        repoWithOrgs([{ id: "org_1", license: "encoded" }]),
      );

      const provider = await resolveAuthProvider();

      expect(provider).toBe("auth0");
    });
  });
});
