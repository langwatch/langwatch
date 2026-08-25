import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { userRouter } from "../user";

vi.mock("../../../../env.mjs", () => ({
  env: { NEXTAUTH_PROVIDER: "email" },
}));

vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("~/runtime/app/features/admin", () => ({
  isAdmin: vi.fn(
    ({ email }: { email: string }) => email === "admin@example.com",
  ),
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

  beforeEach(() => {
    vi.clearAllMocks();
    deactivate = vi.fn().mockResolvedValue({ id: "user-1" });
    reactivate = vi.fn().mockResolvedValue({ id: "user-1" });
  });

  const createCaller = (email = "admin@example.com") => {
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: "caller-1", name: "Caller", email },
        expires: "2099-01-01",
      },
      app: { users: { deactivate, reactivate } } as never,
    });
    return userRouter.createCaller(ctx);
  };

  describe("deactivate()", () => {
    describe("when called", () => {
      /** @scenario user.deactivate sets deactivatedAt on the user */
      it("delegates deactivation to the User service", async () => {
        await createCaller().deactivate({ userId: "user-1" });
        expect(deactivate).toHaveBeenCalledWith({ id: "user-1" });
      });
    });

    describe("when called by a non-admin", () => {
      it("allows users to deactivate themselves", async () => {
        await createCaller("member@example.com").deactivate({
          userId: "caller-1",
        });

        expect(deactivate).toHaveBeenCalledWith({ id: "caller-1" });
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
