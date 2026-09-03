/**
 * @vitest-environment node
 *
 * Setting a FIRST password, for an account that has none.
 *
 * Spec: specs/identity/passkeys.feature
 *
 * Passkey sign-up made passwordless accounts real, and "forgot password" does
 * not rescue one on its own: it updates credential rows in place, so an
 * account that never had a password matched nothing and was told the reset had
 * worked. This is the way out of that, and the reason it is safe to expose
 * with no proof beyond the session is the one refusal asserted below — it can
 * fill an empty slot and never replace a full one.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import type { UserApp } from "../../../app/user.app";
import { UserTrpcApi, type UserTrpcPorts } from "../user.api";

const SELF = { id: "user-1", email: "sam@acme.com" };

function harness({
  setFirstPasswordResult = "set" as "set" | "already_set",
  resolveAuthProvider = vi.fn().mockResolvedValue("email"),
}: {
  setFirstPasswordResult?: "set" | "already_set";
  resolveAuthProvider?: () => Promise<string>;
} = {}) {
  const setFirstPassword = vi.fn().mockResolvedValue(setFirstPasswordResult);
  const revokeOtherBrowserSessions = vi.fn().mockResolvedValue(void 0);

  const users = {
    setFirstPassword,
    revokeOtherBrowserSessions,
  } as unknown as UserApp;

  const rateLimit = vi.fn().mockResolvedValue({ allowed: true });
  const hashPassword = vi.fn().mockImplementation(async ({ password }: { password: string }) => {
    void password;
    return "$2b$10$hashed";
  });

  const trpc = initTRPC
    .context<{ app: { users: UserApp }; session: { user: typeof SELF; sessionId: string } }>()
    .create();

  const router = UserTrpcApi.create(
    trpc as never,
    {
      protected: trpc.procedure,
      public: trpc.procedure,
      policy: () => (procedure: unknown) => procedure,
    } as never,
    {
      resolveAuthProvider,
      rateLimit,
      hashPassword,
    } as unknown as UserTrpcPorts,
  );

  const caller = trpc.createCallerFactory(router as never)({
    app: { users },
    session: { user: SELF, sessionId: "sess-1" },
  });

  return {
    caller: caller as { setPassword(input: { password: string }): Promise<unknown> },
    setFirstPassword,
    revokeOtherBrowserSessions,
    resolveAuthProvider,
  };
}

const call = (harnessResult: ReturnType<typeof harness>, password = "a-good-password") =>
  harnessResult.caller.setPassword({ password });

describe("user.setPassword", () => {
  describe("given an account created by a passkey, holding no password", () => {
    /** @scenario An account with no password can set a first one */
    it("fills the empty credential row rather than asking for a current password", async () => {
      const h = harness({ setFirstPasswordResult: "set" });

      await expect(call(h)).resolves.toMatchObject({ success: true });

      expect(h.setFirstPassword).toHaveBeenCalledWith(expect.objectContaining({ id: "user-1" }));
    });

    /** @scenario A new password ends every other session */
    it("ends every other session, because a password outlives revoking one", async () => {
      const h = harness({ setFirstPasswordResult: "set" });

      await call(h);

      expect(h.revokeOtherBrowserSessions).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-1", keepSessionId: "sess-1" }),
      );
    });
  });

  describe("given an account that already has a password", () => {
    /**
     * The refusal the whole endpoint rests on. Setting a password takes no
     * proof beyond the session; letting it REPLACE one would turn a stolen
     * session into a credential that survives the session being revoked.
     */
    /** @scenario Setting a password can never overwrite one */
    it("refuses, and writes nothing", async () => {
      const h = harness({ setFirstPasswordResult: "already_set" });

      await expect(call(h)).rejects.toBeInstanceOf(TRPCError);
      await expect(call(h)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(h.revokeOtherBrowserSessions).not.toHaveBeenCalled();
    });
  });

  describe("given a password the shared policy refuses", () => {
    it("names the field, so the refusal lands where the person is looking", async () => {
      const h = harness();

      await expect(call(h, "short")).rejects.toMatchObject({
        // The policy check runs before anything is read or written.
        message: expect.stringContaining("8"),
      });
      expect(h.setFirstPassword).not.toHaveBeenCalled();
    });
  });

  describe("given a deployment that federates", () => {
    it("refuses, because the password does not live here", async () => {
      const h = harness({ resolveAuthProvider: vi.fn().mockResolvedValue("auth0") });

      await expect(call(h)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(h.setFirstPassword).not.toHaveBeenCalled();
    });
  });
});
