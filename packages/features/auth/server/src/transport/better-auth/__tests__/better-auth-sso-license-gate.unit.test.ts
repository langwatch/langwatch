/**
 * The `before` request hook `createAuthOptions` wires (ADR-027 gate site #3,
 * ADR-117 §4) — which BetterAuth routes the platform SSO license gate refuses,
 * and which paths never even ask because the gate cannot change their answer.
 */
import type { SignInMethod, SignInMethodPolicy } from "@langwatch/identity-contract";
import { APIError } from "better-auth/api";
import { describe, expect, it, vi } from "vitest";

import type {
  BetterAuthFederationPort,
  BetterAuthIdentityCeremoniesPort,
  BetterAuthStoragePort,
} from "../../../ports/better-auth.port";
import { createAuthOptions, type BetterAuthDeploymentConfiguration } from "../better-auth.api";
import type { SignInRouterShadowPort } from "../sign-in-router-shadow.api";

const PASSWORD: SignInMethod = { id: "password", kind: "password", connectionId: null };
const OKTA: SignInMethod = { id: "okta", kind: "federated", connectionId: "org_acme" };

class StubFederationPort implements BetterAuthFederationPort {
  federationCapableValue = true;
  policy: SignInMethodPolicy = {
    defaultMethods: [PASSWORD],
    localMethods: [PASSWORD],
    federationLicensed: false,
    selfHosted: true,
  };
  resolvePolicy = vi.fn(async () => this.policy);

  federationCapable(): boolean {
    return this.federationCapableValue;
  }
  resolveSignInMethodPolicy(): Promise<SignInMethodPolicy> {
    return this.resolvePolicy();
  }
  platformSsoAllowed(): Promise<boolean> {
    return Promise.reject(new Error("unused"));
  }
}

class StubShadowPort implements SignInRouterShadowPort {
  mode() {
    return "off" as const;
  }
  route(): never {
    throw new Error("unused");
  }
  resolveAuthProvider(): never {
    throw new Error("unused");
  }
}

class StubStoragePort implements BetterAuthStoragePort {
  adapter(): unknown {
    return {};
  }
}

class StubIdentityPort implements BetterAuthIdentityCeremoniesPort {
  beforeUserDelete(): Promise<void> {
    return Promise.reject(new Error("unused"));
  }
  tryBeforeAccountCreate(): Promise<{ data: { id: string } } | undefined> {
    return Promise.reject(new Error("unused"));
  }
  beforeAccountDelete(): Promise<void> {
    return Promise.reject(new Error("unused"));
  }
}

const deployment: BetterAuthDeploymentConfiguration = {
  baseUrl: "https://app.test",
  secret: "test-secret",
  emailPasswordEnabled: true,
  mfaEnrollmentOpen: false,
  passkeysEnabled: false,
  passkeyHandleSecret: "test-passkey-secret",
  socialProviders: {},
  genericOAuthConfigs: [],
};

function buildHook(federation: StubFederationPort) {
  const authOptions = createAuthOptions({
    prisma: {} as never,
    deployment,
    storage: new StubStoragePort(),
    federation,
    identity: new StubIdentityPort(),
    shadow: new StubShadowPort(),
    hooks: {} as never,
  });
  const before = authOptions.hooks?.before;
  if (!before) throw new Error("createAuthOptions did not wire a `before` hook");
  return (path: string, body: unknown = {}) =>
    before({ request: { url: `https://app.test${path}` }, body } as never);
}

describe("the SSO license-gate request hook", () => {
  describe("given an unlicensed deployment with an enterprise IdP configured", () => {
    /** @scenario "SSO sign-in routes are refused while the deployment is unlicensed" */
    it("refuses SSO initiation and the legacy callback paths", async () => {
      const federation = new StubFederationPort();
      federation.policy = { ...federation.policy, federationLicensed: false };
      const run = buildHook(federation);

      await expect(run("/api/auth/sign-in/social")).rejects.toThrow(APIError);
      await expect(run("/api/auth/callback/auth0")).rejects.toThrow(APIError);
    });
  });

  describe("given a genuinely licensed deployment whose configured IdP this build cannot mount", () => {
    /** @scenario "The form a misconfigured deployment offers actually accepts a sign-in" */
    it("accepts the email/password form instead of refusing it as identity-provider managed", async () => {
      const federation = new StubFederationPort();
      federation.policy = {
        defaultMethods: [PASSWORD],
        localMethods: [PASSWORD],
        federationLicensed: true,
        selfHosted: true,
      };
      const run = buildHook(federation);

      await expect(run("/api/auth/sign-in/email", { email: "a@b.com" })).resolves.toBeUndefined();
    });
  });

  describe("given a deployment whose identity provider mounted successfully", () => {
    /** @scenario "A deployment that really does federate still refuses password accounts" */
    it("refuses the email/password form because the identity provider owns the password", async () => {
      const federation = new StubFederationPort();
      federation.policy = {
        defaultMethods: [OKTA],
        localMethods: [PASSWORD],
        federationLicensed: true,
        selfHosted: true,
      };
      const run = buildHook(federation);

      await expect(run("/api/auth/sign-in/email", { email: "a@b.com" })).rejects.toThrow(APIError);
    });
  });

  describe("given an enterprise IdP is configured", () => {
    /** @scenario "No password can be attached to an SSO account without inbox proof" */
    it("refuses a direct password-mutation attempt regardless of license state", async () => {
      for (const licensed of [true, false]) {
        const federation = new StubFederationPort();
        federation.policy = { ...federation.policy, federationLicensed: licensed };
        const run = buildHook(federation);

        await expect(run("/api/auth/change-password")).rejects.toThrow(APIError);
        expect(federation.resolvePolicy).not.toHaveBeenCalled();
      }
    });
  });

  describe("given a signed-in user's browser reading its own session", () => {
    /** @scenario "Existing sessions keep working across a gate change" */
    it("answers without consulting the license gate at all", async () => {
      const federation = new StubFederationPort();
      const run = buildHook(federation);

      await expect(run("/api/auth/get-session")).resolves.toBeUndefined();
      expect(federation.resolvePolicy).not.toHaveBeenCalled();
    });

    /** @scenario "A slow licensing store does not hold up signed-in users" */
    it("does not wait on the licensing store even when it never answers", async () => {
      const federation = new StubFederationPort();
      federation.resolvePolicy.mockImplementation(() => new Promise(() => {}));
      const run = buildHook(federation);

      await expect(run("/api/auth/sign-out")).resolves.toBeUndefined();
      expect(federation.resolvePolicy).not.toHaveBeenCalled();
    });
  });
});
