/**
 * @vitest-environment node
 * better-auth's `/sign-up/email` — so the ADR-027 email-mode coercion must
 * @see specs/licensing/sso-license-gating.feature
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { UserApp } from "../../../app/user.app";
import { UserTrpcApi, type UserTrpcPorts } from "../user.api";

function harness({ resolvedProvider }: { resolvedProvider: string }) {
  const createCredentialUser = vi
    .fn()
    .mockResolvedValue({ id: "user-1", name: "Operator", email: "operator@example.com" });
  const users = { createCredentialUser } as unknown as UserApp;

  const ports: UserTrpcPorts = {
    resolveAuthProvider: vi.fn().mockResolvedValue(resolvedProvider),
    deploymentOffersPasskeys: vi.fn().mockReturnValue(false),
    appBaseUrl: vi.fn().mockReturnValue(null),
    clientIp: vi.fn().mockReturnValue("127.0.0.1"),
    rateLimit: vi.fn().mockResolvedValue({ allowed: true }),
    trackServerEvent: vi.fn(),
    hashPassword: vi.fn().mockResolvedValue("$2b$10$hashed"),
    emailIsTaken: vi.fn().mockResolvedValue(false),
  } as unknown as UserTrpcPorts;

  const trpc = initTRPC.context<{ app: { users: UserApp }; session: null }>().create();

  const router = UserTrpcApi.create(
    trpc as never,
    {
      protected: trpc.procedure,
      public: trpc.procedure,
      policy: () => (procedure: unknown) => procedure,
    } as never,
    ports,
  );

  const caller = trpc.createCallerFactory(router as never)({
    app: { users },
    session: null,
  });

  return {
    caller: caller as {
      register(input: { name?: string; email: string; password: string }): Promise<{ id: string }>;
    },
    createCredentialUser,
  };
}

describe("user.register", () => {
  describe("given an SSO-capable deployment where the gate denies (coerced email mode)", () => {
    /** @scenario "A fresh unlicensed deployment bootstraps via email signup" */
    it("registers the user through the signup form's tRPC path", async () => {
      const h = harness({ resolvedProvider: "email" });

      await expect(
        h.caller.register({
          name: "Operator",
          email: "operator@example.com",
          password: "password-123",
        }),
      ).resolves.toMatchObject({ id: "user-1" });
      expect(h.createCredentialUser).toHaveBeenCalled();
    });
  });

  describe("given an SSO-capable deployment where the gate allows", () => {
    /** @scenario "A licensed deployment cannot mint password accounts" */
    it("refuses direct registration", async () => {
      const h = harness({ resolvedProvider: "auth0" });

      await expect(
        h.caller.register({
          name: "Operator",
          email: "operator@example.com",
          password: "password-123",
        }),
      ).rejects.toBeInstanceOf(TRPCError);
      expect(h.createCredentialUser).not.toHaveBeenCalled();
    });
  });
});
