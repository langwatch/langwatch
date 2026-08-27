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

const { platformSSOAllowedMock, resolveAuthProviderMock } = vi.hoisted(() => ({
  platformSSOAllowedMock: vi.fn(),
  resolveAuthProviderMock: vi.fn(),
}));
vi.mock("~/runtime/app/features/sso", () => ({
  platformSSOAllowed: platformSSOAllowedMock,
  resolveAuthProvider: resolveAuthProviderMock,
}));

import { routeSignIn } from "@langwatch/identity";
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

function licensedStore(licensed: boolean) {
  platformSSOAllowedMock.mockResolvedValue(licensed);
  resolveAuthProviderMock.mockResolvedValue(licensed ? "auth0" : "email");
}

describe("the instance sign-in method policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      expect(policy.defaultMethods.some((method) => method.kind === "federated")).toBe(false);
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

  describe("when the deployment names no federated method at all", () => {
    it("answers the capability question without waiting on the licensing store", () => {
      envMock.NEXTAUTH_PROVIDER = "email";

      // Synchronous by contract: the before-hook must be able to leave an
      // email-mode deployment alone without a store read in the way.
      expect(deploymentIsFederationCapable()).toBe(false);
      expect(platformSSOAllowedMock).not.toHaveBeenCalled();
    });
  });
});
