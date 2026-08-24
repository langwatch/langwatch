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

// An App carrying no Redis, so the revoke helper UserService.deactivate calls
// takes its Postgres-only path instead of talking to a real Redis.
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ redis: null }),
  tryGetApp: () => ({ redis: null }),
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
  let prismaUpdateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaUpdateMock = vi.fn().mockResolvedValue({ id: "user-1" });
  });

  const createCaller = (email = "admin@example.com") => {
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: "caller-1", name: "Caller", email },
        expires: "2099-01-01",
      },
    });
    (ctx as any).prisma = {
      user: { update: prismaUpdateMock },
      // UserService.deactivate also revokes all sessions for the user;
      // mock the session model so the revocation completes cleanly.
      session: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    return userRouter.createCaller(ctx);
  };

  describe("deactivate()", () => {
    describe("when called", () => {
      /** @scenario user.deactivate sets deactivatedAt on the user */
      it("sets deactivatedAt on the user", async () => {
        const before = new Date();
        await createCaller().deactivate({ userId: "user-1" });

        const callArgs = prismaUpdateMock.mock.calls[0]![0];
        expect(callArgs.where).toEqual({ id: "user-1" });
        expect(callArgs.data.deactivatedAt).toBeInstanceOf(Date);
        expect(callArgs.data.deactivatedAt.getTime()).toBeGreaterThanOrEqual(
          before.getTime(),
        );
      });
    });

    describe("when called by a non-admin", () => {
      it("allows users to deactivate themselves", async () => {
        await createCaller("member@example.com").deactivate({
          userId: "caller-1",
        });

        expect(prismaUpdateMock).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: "caller-1" } }),
        );
      });

      it("rejects the request", async () => {
        await expect(
          createCaller("member@example.com").deactivate({ userId: "user-1" }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        expect(prismaUpdateMock).not.toHaveBeenCalled();
      });
    });
  });

  describe("reactivate()", () => {
    describe("when called", () => {
      /** @scenario user.reactivate clears deactivatedAt on the user */
      it("clears deactivatedAt to null", async () => {
        await createCaller().reactivate({ userId: "user-1" });

        const callArgs = prismaUpdateMock.mock.calls[0]![0];
        expect(callArgs.where).toEqual({ id: "user-1" });
        expect(callArgs.data.deactivatedAt).toBeNull();
      });
    });

    describe("when called by a non-admin", () => {
      it("rejects the request", async () => {
        await expect(
          createCaller("member@example.com").reactivate({ userId: "user-1" }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        expect(prismaUpdateMock).not.toHaveBeenCalled();
      });
    });
  });
});
