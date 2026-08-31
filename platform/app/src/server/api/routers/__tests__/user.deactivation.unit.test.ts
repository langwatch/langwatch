import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { appRouter } from "../../root";

vi.mock("../../../../env.mjs", () => ({
  env: { NEXTAUTH_PROVIDER: "email" },
}));

vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    skipPermissionCheck: ({ ctx, next }: any) => {
      ctx.permissionChecked = true;
      return next();
    },
  };
});

describe("userRouter", () => {
  let deactivate: ReturnType<typeof vi.fn>;
  let reactivate: ReturnType<typeof vi.fn>;
  let revokeAllBrowserSessions: ReturnType<typeof vi.fn>;
  let cliTokenRevokeForUser: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    deactivate = vi.fn().mockResolvedValue({ id: "user-1" });
    reactivate = vi.fn().mockResolvedValue({ id: "user-1" });
    revokeAllBrowserSessions = vi.fn().mockResolvedValue(undefined);
    cliTokenRevokeForUser = vi.fn().mockResolvedValue(undefined);
  });

  const createCaller = (email = "admin@example.com") => {
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: "caller-1", name: "Caller", email },
        expires: "2099-01-01",
      },
      app: {
        // The router talks to `app.users` and nothing else. `UserApp` is the
        // one surface: it owns `isAdmin` and `revokeAllBrowserSessions` and
        // delegates them inward to the ops and auth services. This stub used
        // to model those inner services instead — `ops.isAdmin`,
        // `auth.revokeAllBrowserSessions` — which is where they lived before
        // the facade, and the router found neither on `users`.
        users: {
          deactivate,
          reactivate,
          revokeAllBrowserSessions,
          isAdmin: ({ email }: { email: string }) => email === "admin@example.com",
        },
        governance: { cliTokenRevokeForUser },
        permissions: {
          checkScopeLineage: vi.fn().mockResolvedValue({ kind: "consistent" }),
        },
      } as never,
    });
    return appRouter.createCaller(ctx).user;
  };

  describe("deactivate()", () => {
    describe("when called", () => {
      /** @scenario user.deactivate sets deactivatedAt on the user */
      it("delegates deactivation to the User service", async () => {
        await createCaller().deactivate({ userId: "user-1" });
        expect(deactivate).toHaveBeenCalledWith({ id: "user-1" });
        expect(revokeAllBrowserSessions).toHaveBeenCalledWith({ userId: "user-1" });
        expect(cliTokenRevokeForUser).toHaveBeenCalledWith({ userId: "user-1" });
      });
    });

    describe("when called by a non-admin", () => {
      it("allows users to deactivate themselves", async () => {
        await createCaller("member@example.com").deactivate({
          userId: "caller-1",
        });

        expect(deactivate).toHaveBeenCalledWith({ id: "caller-1" });
        expect(revokeAllBrowserSessions).toHaveBeenCalledWith({ userId: "caller-1" });
        expect(cliTokenRevokeForUser).toHaveBeenCalledWith({ userId: "caller-1" });
      });

      it("rejects the request", async () => {
        await expect(
          createCaller("member@example.com").deactivate({ userId: "user-1" }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        expect(deactivate).not.toHaveBeenCalled();
      });
    });
  });

  describe("reactivate()", () => {
    describe("when called", () => {
      /** @scenario user.reactivate clears deactivatedAt on the user */
      it("delegates reactivation to the User service", async () => {
        await createCaller().reactivate({ userId: "user-1" });
        expect(reactivate).toHaveBeenCalledWith({ id: "user-1" });
      });
    });

    describe("when called by a non-admin", () => {
      it("rejects the request", async () => {
        await expect(
          createCaller("member@example.com").reactivate({ userId: "user-1" }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        expect(reactivate).not.toHaveBeenCalled();
      });
    });
  });
});
