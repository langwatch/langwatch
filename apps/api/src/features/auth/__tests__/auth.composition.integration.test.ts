/**
 * The auth module as the API process installs it.
 *
 * Booted over the memory repositories rather than a Prisma double: the point of
 * the installer is that persistence is chosen once, at boot, so the graph this
 * test drives is the one `installApiUser` builds over Postgres. What it proves
 * is the wiring - the module boots in the `api` role, answers the signed-out
 * door from its own rows, and refuses by name for every capability this
 * deployment did not compose.
 */
import type { AuthInfrastructure } from "@langwatch/auth-server";
import { authServer } from "@langwatch/auth-server";
import { createApp } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

const PROCESS_NAME = "langwatch-api";

/** Everything the process holds; each case narrows one part of it. */
function infrastructure(overrides: Partial<AuthInfrastructure> = {}): AuthInfrastructure {
  return {
    redis: null,
    identityEmails: { tryResolveEmail: async () => null },
    rateLimit: async () => ({ allowed: true }),
    route: async () => {
      throw new Error("no case routes a sign-in");
    },
    signUp: null,
    invites: null,
    authProvider: async () => "email",
    processName: PROCESS_NAME,
    ...overrides,
  };
}

async function bootAuth(overrides: Partial<AuthInfrastructure> = {}) {
  const runtime = await createApp({ name: PROCESS_NAME })
    .withPersistence("memory", {})
    .withInfrastructure({})
    .withProvided(UserApi, createApiFixture<UserApi>())
    .withModule(authServer, { infrastructure: infrastructure(overrides) })
    .boot({ role: "api" });

  return runtime.module(authServer).provided;
}

describe("given the API process installs the auth module", () => {
  describe("when the deployment composed no mail gateway", () => {
    it("refuses the sign-up ceremony by name rather than answering", async () => {
      const auth = await bootAuth();

      await expect(auth.requestSignUpVerification({ email: "ana@acme.com" })).rejects.toMatchObject(
        { code: "service_unavailable", httpStatus: 503, fault: "platform" },
      );
    });

    it("names the capability and the process in the refusal", async () => {
      const auth = await bootAuth();

      await expect(auth.addressIsRegistered({ email: "ana@acme.com" })).rejects.toThrow(
        `${PROCESS_NAME} composes no mail gateway with a public base URL`,
      );
    });
  });

  describe("when the deployment composed no invitation service", () => {
    it("refuses a reissue request rather than minting a fresh code", async () => {
      const auth = await bootAuth();

      await expect(auth.requestFreshInvite({ inviteCode: "code-1" })).rejects.toMatchObject({
        code: "service_unavailable",
      });
    });
  });

  describe("when the deployment composed the sign-up ceremony", () => {
    it("mails a confirmation link and spends it against its own token rows", async () => {
      const sent: Array<{ email: string; verificationUrl: string }> = [];
      const confirmed: string[] = [];
      const auth = await bootAuth({
        signUp: {
          accounts: {
            hasAccountFor: async () => confirmed.length > 0,
            markAddressConfirmed: async ({ email }) => void confirmed.push(email),
          },
          mailer: { sendVerificationLink: async (input) => void sent.push(input) },
          baseUrl: "https://app.test",
        },
      });

      await auth.requestSignUpVerification({ email: "ana@acme.com" });

      const link = sent.at(0);
      expect(link?.email).toBe("ana@acme.com");
      const token = new URL(link?.verificationUrl ?? "").searchParams.get("verify");
      expect(token).toBeTruthy();

      await expect(auth.completeSignUpVerification({ token: token ?? "" })).resolves.toMatchObject({
        email: "ana@acme.com",
        accountCreated: false,
      });
    });

    it("refuses a link that has already been spent", async () => {
      const sent: Array<{ email: string; verificationUrl: string }> = [];
      const auth = await bootAuth({
        signUp: {
          accounts: {
            hasAccountFor: async () => true,
            markAddressConfirmed: async () => undefined,
          },
          mailer: { sendVerificationLink: async (input) => void sent.push(input) },
          baseUrl: "https://app.test",
        },
      });

      await auth.requestSignUpVerification({ email: "ana@acme.com" });
      const token =
        new URL(sent.at(0)?.verificationUrl ?? "").searchParams.get("verify") ?? "missing";

      await auth.completeSignUpVerification({ token });

      await expect(auth.completeSignUpVerification({ token })).rejects.toThrow();
    });
  });

  describe("when a browser session is revoked", () => {
    it("answers zero deletions from its own rows rather than reaching a database", async () => {
      const auth = await bootAuth();

      await expect(
        auth.revokeOtherBrowserSessions({ userId: "user-1", keepSessionId: "session-1" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the caller asks which sign-in mode the deployment offers", () => {
    it("answers the mode the process resolved, not an environment variable", async () => {
      const auth = await bootAuth({ authProvider: async () => "auth0" });

      await expect(auth.resolveAuthProvider()).resolves.toBe("auth0");
    });
  });
});
