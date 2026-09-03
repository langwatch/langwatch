/**
 * @vitest-environment node
 *
 * The PostHog signed_up milestone on the tRPC `register` mutation — the
 * signup page's own choke point, which writes the User row through Prisma
 * directly rather than through better-auth's `/sign-up/email` (see
 * born-finalized-opt-in.ts). It owns the event for the users it creates, and
 * a rejected registration must track nothing: an attempt is not a signup.
 */
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { UserApp } from "../../../app/user.app";
import { UserTrpcApi, type UserTrpcPorts } from "../user.api";

function harness({
  emailIsTaken = false,
  createCredentialUserResult = { id: "user-1", name: "Alice", email: "a@x.com" },
}: {
  emailIsTaken?: boolean;
  createCredentialUserResult?: { id: string; name: string | null; email: string };
} = {}) {
  const trackServerEvent = vi.fn();
  const createCredentialUser = vi.fn().mockResolvedValue(createCredentialUserResult);
  const users = { createCredentialUser } as unknown as UserApp;

  const ports: UserTrpcPorts = {
    resolveAuthProvider: vi.fn().mockResolvedValue("email"),
    deploymentOffersPasskeys: vi.fn().mockReturnValue(false),
    appBaseUrl: vi.fn().mockReturnValue(null),
    clientIp: vi.fn().mockReturnValue("127.0.0.1"),
    rateLimit: vi.fn().mockResolvedValue({ allowed: true }),
    trackServerEvent,
    hashPassword: vi.fn().mockResolvedValue("$2b$10$hashed"),
    emailIsTaken: vi.fn().mockResolvedValue(emailIsTaken),
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
    trackServerEvent,
    createCredentialUser,
  };
}

describe("user.register", () => {
  describe("when registration succeeds", () => {
    /** @scenario Email-mode registration tracks the PostHog signed_up milestone exactly once */
    it("tracks the signed_up analytics event with the new user id", async () => {
      const h = harness();

      const result = await h.caller.register({
        name: "Alice",
        email: "a@x.com",
        password: "supersecret",
      });

      expect(result).toEqual({ id: "user-1" });
      expect(h.trackServerEvent).toHaveBeenCalledTimes(1);
      expect(h.trackServerEvent).toHaveBeenCalledWith({
        userId: "user-1",
        event: "signed_up",
      });
    });
  });

  describe("when the email is already registered", () => {
    /** @scenario A rejected registration tracks no PostHog signed_up milestone */
    it("tracks no signed_up analytics event", async () => {
      const h = harness({ emailIsTaken: true });

      await expect(
        h.caller.register({ name: "Alice", email: "a@x.com", password: "supersecret" }),
      ).rejects.toThrow();

      expect(h.createCredentialUser).not.toHaveBeenCalled();
      expect(h.trackServerEvent).not.toHaveBeenCalled();
    });
  });
});
