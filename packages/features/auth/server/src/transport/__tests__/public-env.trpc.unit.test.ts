/**
 * @vitest-environment node
 * The `publicEnv` procedure. It proxies straight to
 * `AuthApp.resolveAuthProvider`, where the SSO-license gate lives.
 */
import { bindTrpcFact, createTrpcRuntime } from "@langwatch/api/trpc";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { AuthApp, type AuthAppDependencies } from "../../app/auth.app.ts";
import {
  operatorAllowListFact,
  publicEnvTrpcTransport,
  viewerEmailFact,
} from "../public-env.trpc.ts";
import { authTrpcTestPorts, type AuthTrpcTestContext } from "./auth.trpc.harness.ts";

function harness({ resolveAuthProvider }: { resolveAuthProvider: () => Promise<string> }) {
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
  const trpc = initTRPC.context<AuthTrpcTestContext>().create();

  const router = createTrpcRuntime<AuthTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    anonymousProcedure: trpc.procedure,
    ports: authTrpcTestPorts(),
  }).mount(publicEnvTrpcTransport, () => app, {
    facts: [
      bindTrpcFact(viewerEmailFact, (ctx) => ctx.email ?? null),
      bindTrpcFact(operatorAllowListFact, (ctx) => ctx.operators ?? null),
    ],
  });

  return { router };
}

describe("the publicEnv procedure", () => {
  describe("given the mounted declaration", () => {
    it("is one query, named for itself, so the browser still calls it at the root", () => {
      const { router } = harness({ resolveAuthProvider: async () => "email" });

      expect(Object.keys(router._def.procedures)).toEqual(["publicEnv"]);
    });
  });

  describe("when the platform SSO gate allows", () => {
    it("reports the configured provider via resolveAuthProvider", async () => {
      const resolveAuthProvider = vi.fn<() => Promise<string>>(async () => "auth0");
      const { router } = harness({ resolveAuthProvider });

      const result = await router.createCaller({}).publicEnv({});

      expect(resolveAuthProvider).toHaveBeenCalled();
      expect(result.NEXTAUTH_PROVIDER).toBe("auth0");
    });
  });

  describe("when the platform SSO gate denies", () => {
    /** @scenario Self-hosted that never had a license hides SSO and offers email sign-in */
    it("reports email instead of the raw env var, so the sign-in page renders the email form", async () => {
      const { router } = harness({ resolveAuthProvider: async () => "email" });

      const result = await router.createCaller({}).publicEnv({});

      expect(result.NEXTAUTH_PROVIDER).toBe("email");
    });
  });

  describe("when the deployment named the viewer an operator", () => {
    it("shows the operator entry, matching the address case-folded and trimmed", async () => {
      const { router } = harness({ resolveAuthProvider: async () => "email" });

      const result = await router
        .createCaller({ email: " Ops@Example.com ", operators: ["ops@example.com"] })
        .publicEnv({});

      expect(result.SHOW_OPS_IN_MAIN_SIDEBAR).toBe(true);
    });

    it("hides it from every other viewer, including one the process resolved no address for", async () => {
      const { router } = harness({ resolveAuthProvider: async () => "email" });

      const other = await router
        .createCaller({ email: "someone@example.com", operators: ["ops@example.com"] })
        .publicEnv({});
      const anonymous = await router
        .createCaller({ operators: ["ops@example.com"] })
        .publicEnv({});

      expect([other.SHOW_OPS_IN_MAIN_SIDEBAR, anonymous.SHOW_OPS_IN_MAIN_SIDEBAR]).toEqual([
        false,
        false,
      ]);
    });
  });
});
