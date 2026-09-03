/**
 * @vitest-environment node
 *
 * The `publicEnv` procedure: the one deployment fact a signed-out browser may
 * ask for. It proxies straight to `AuthApp.resolveAuthProvider`, which is
 * where the SSO-license gate now lives (`SsoGateService`) — this surface only
 * has to pass the app's answer through untouched.
 */
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { AuthApp, type AuthAppDependencies } from "../../../app/auth.app";
import { PublicEnvTrpcApi, type PublicEnvTrpcContext } from "../public-env.api";

function harness({ resolveAuthProvider }: { resolveAuthProvider: () => Promise<string> }) {
  const trpc = initTRPC.context<PublicEnvTrpcContext>().create();

  const declared: unknown[] = [];
  const policy = (declaration: unknown) => {
    declared.push(declaration);
    return <TProcedure>(procedure: TProcedure): TProcedure => procedure;
  };

  const dependencies: AuthAppDependencies = {
    clientIp: () => "unknown",
    rateLimit: async () => ({ allowed: true }),
    route: async () => ({ kind: "email" }) as never,
    addressIsRegistered: async () => false,
    requestSignUpVerification: async () => undefined,
    completeSignUpVerification: async () => ({
      email: "",
      accountCreated: false,
      accountExists: false,
    }),
    readInviteLanding: async () => ({
      organizationName: "",
      inviterName: null,
      alreadyAccepted: false,
    }),
    requestFreshInvite: async () => undefined,
    resolveAuthProvider,
  };
  const app = AuthApp.create(dependencies);

  const router = trpc.router({
    publicEnv: PublicEnvTrpcApi.create({ public: trpc.procedure, policy }, app),
  });

  const ctx: PublicEnvTrpcContext = {
    session: null,
    app: { config: { opsSidebarEmails: undefined } },
  };

  return { caller: router.createCaller(ctx), declared };
}

describe("publicEnvRouter", () => {
  describe("when the platform SSO gate allows", () => {
    it("reports the configured provider via resolveAuthProvider", async () => {
      const resolveAuthProvider = vi.fn(async () => "auth0");
      const { caller } = harness({ resolveAuthProvider });

      const result = await caller.publicEnv({});

      expect(resolveAuthProvider).toHaveBeenCalled();
      expect(result.NEXTAUTH_PROVIDER).toBe("auth0");
    });
  });

  describe("when the platform SSO gate denies", () => {
    /** @scenario Self-hosted that never had a license hides SSO and offers email sign-in */
    it("reports email instead of the raw env var, so the sign-in page renders the email form", async () => {
      const { caller } = harness({ resolveAuthProvider: async () => "email" });

      const result = await caller.publicEnv({});

      expect(result.NEXTAUTH_PROVIDER).toBe("email");
    });
  });
});
