import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ prisma: {} }));

// The real license gate, over a stubbed licensing store. What this file has to
// prove is that ADR-027's semantics survive being expressed as method policy,
// and a mocked gate would prove only that the mock was called.
vi.mock("~/env.mjs", () => ({
  env: {
    IS_SAAS: false,
    NEXTAUTH_PROVIDER: "auth0",
    LANGWATCH_LICENSE_KEY: undefined as string | undefined,
    AUTH0_CLIENT_ID: "auth0-client",
    AUTH0_CLIENT_SECRET: "auth0-secret",
    AUTH0_ISSUER: "https://acme.us.auth0.com/",
    NEXTAUTH_URL: "https://acme.test",
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
vi.mock("@langwatch/observability", () => ({ createLogger: () => loggerMock }));

vi.mock("../../../../../ee/licensing/validation", () => ({
  parseLicenseKey: vi.fn(),
  verifySignature: vi.fn(),
  isExpired: vi.fn(),
}));

import {
  __resetSsoGateForTests,
  __setSsoLicenseRepositoryForTests,
} from "@ee/sso/sso-gate";
import { routeSignIn } from "@langwatch/identity";
import {
  isExpired,
  parseLicenseKey,
  verifySignature,
} from "../../../../../ee/licensing/validation";
import {
  deploymentIsFederationCapable,
  LOCAL_METHOD_SET,
  PASSWORD_METHOD,
  resolveSignInMethodPolicy,
} from "../signin-method-policy";

const envMock = (await import("~/env.mjs")).env as unknown as {
  NEXTAUTH_PROVIDER: string;
  IS_SAAS: boolean;
};

const genuineLicense = () => ({
  data: { expiresAt: "2099-01-01", organizationName: "Acme" },
});

function licensedStore(licensed: boolean) {
  __setSsoLicenseRepositoryForTests({
    findOrganizationsWithLicense: vi
      .fn()
      .mockResolvedValue(licensed ? [{ id: "org_1", license: "encoded" }] : []),
  });
  vi.mocked(parseLicenseKey).mockReturnValue(genuineLicense() as never);
  vi.mocked(verifySignature).mockReturnValue(licensed);
  vi.mocked(isExpired).mockReturnValue(false);
}

describe("the instance sign-in method policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetSsoGateForTests();
    envMock.NEXTAUTH_PROVIDER = "auth0";
    envMock.IS_SAAS = false;
  });

  describe("given a self-hosted installation configured with a single OAuth provider", () => {
    beforeEach(() => {
      licensedStore(true);
    });

    /** @scenario "The provider env becomes the default method set" */
    it("makes the configured provider the offered method, exactly as before", async () => {
      const policy = await resolveSignInMethodPolicy();

      expect(policy.defaultMethods).toEqual([
        { id: "auth0", kind: "federated", connectionId: null },
      ]);
      expect(policy.federationLicensed).toBe(true);
      expect(policy.selfHosted).toBe(true);
    });

    /** @scenario "The provider env becomes the default method set" */
    it("ends nothing when a second method joins the set", async () => {
      const policy = await resolveSignInMethodPolicy();
      const withPasskey = {
        ...policy,
        defaultMethods: [
          ...policy.defaultMethods,
          { id: "passkey", kind: "passkey" as const, connectionId: null },
        ],
      };

      const decision = routeSignIn({
        identifier: null,
        breakGlass: false,
        policy: withPasskey,
        domainConnection: null,
        activeConnections: [],
      });

      // The first method is still there, and still offered: a method set is
      // additive, which is the entire difference from a global one-provider
      // invariant.
      expect(decision.methodSet).toEqual(withPasskey.defaultMethods);
      expect(decision.methodSet[0]).toEqual({
        id: "auth0",
        kind: "federated",
        connectionId: null,
      });
    });
  });

  describe("given a self-hosted installation whose license gate denies", () => {
    beforeEach(() => {
      licensedStore(false);
    });

    /** @scenario "A never-licensed installation offers no federated method" */
    it("offers the email and password method set and no federated one", async () => {
      const policy = await resolveSignInMethodPolicy();

      expect(policy.federationLicensed).toBe(false);
      expect(policy.defaultMethods).toEqual([PASSWORD_METHOD]);
      expect(policy.localMethods).toEqual(LOCAL_METHOD_SET);
      expect(
        policy.defaultMethods.some((method) => method.kind === "federated"),
      ).toBe(false);
    });

    /** @scenario "A never-licensed installation offers no federated method" */
    it("keeps every federated method out of the routing decision too", async () => {
      const policy = await resolveSignInMethodPolicy();

      const decision = routeSignIn({
        identifier: null,
        breakGlass: false,
        policy,
        domainConnection: null,
        activeConnections: [],
      });

      expect(decision.outcome).toBe("method_picker");
      expect(decision.methodSet).toEqual([PASSWORD_METHOD]);
    });
  });

  describe("when a license is activated mid-process", () => {
    /** @scenario "The license gate still freezes at startup" */
    it("does not change routing decisions until the next restart", async () => {
      const findOrganizationsWithLicense = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "org_1", license: "encoded" }]);
      __setSsoLicenseRepositoryForTests({ findOrganizationsWithLicense });

      const atStartup = await resolveSignInMethodPolicy();
      expect(atStartup.federationLicensed).toBe(false);

      // The license lands in the database, signature and all.
      vi.mocked(parseLicenseKey).mockReturnValue(genuineLicense() as never);
      vi.mocked(verifySignature).mockReturnValue(true);
      vi.mocked(isExpired).mockReturnValue(false);

      const sameProcess = await resolveSignInMethodPolicy();
      expect(sameProcess.federationLicensed).toBe(false);
      expect(sameProcess.defaultMethods).toEqual(atStartup.defaultMethods);
      expect(findOrganizationsWithLicense).toHaveBeenCalledTimes(1);

      // A restart, and only a restart, re-decides.
      __resetSsoGateForTests();
      __setSsoLicenseRepositoryForTests({ findOrganizationsWithLicense });
      const afterRestart = await resolveSignInMethodPolicy();
      expect(afterRestart.federationLicensed).toBe(true);
    });
  });

  describe("when the deployment names no federated method at all", () => {
    it("answers the capability question without waiting on the licensing store", () => {
      envMock.NEXTAUTH_PROVIDER = "email";
      const store = vi.fn();
      __setSsoLicenseRepositoryForTests({
        findOrganizationsWithLicense: store,
      });

      // Synchronous by contract: the before-hook must be able to leave an
      // email-mode deployment alone without a store read in the way.
      expect(deploymentIsFederationCapable()).toBe(false);
      expect(store).not.toHaveBeenCalled();
    });
  });
});
