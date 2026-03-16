import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { userRouter } from "../user";
import { createInnerTRPCContext } from "../../trpc";

vi.mock("../../../../env.mjs", () => ({
  env: {
    ADMIN_EMAILS: "admin@langwatch.ai",
    NEXTAUTH_PROVIDER: "email",
  },
}));

const ADMIN_EMAIL = "admin@langwatch.ai";

vi.mock("../../../auditLog", () => ({
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
  let prismaUpdateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaUpdateMock = vi.fn().mockResolvedValue({ id: "user-1" });
  });

  const createCaller = ({ email }: { email: string }) => {
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: "caller-1", name: "Caller", email },
        expires: "2099-01-01",
      },
    });
    (ctx as any).prisma = {
      user: {
        update: prismaUpdateMock,
      },
    };
    return userRouter.createCaller(ctx);
  };

  describe("deactivate()", () => {
    describe("when called by a platform admin", () => {
      it("sets deactivatedAt to the current timestamp", async () => {
        const caller = createCaller({ email: ADMIN_EMAIL });
        const before = new Date();

        await caller.deactivate({ userId: "user-1" });

        expect(prismaUpdateMock).toHaveBeenCalledOnce();
        const callArgs = prismaUpdateMock.mock.calls[0]![0];
        expect(callArgs.where).toEqual({ id: "user-1" });
        expect(callArgs.data.deactivatedAt).toBeInstanceOf(Date);
        expect(callArgs.data.deactivatedAt.getTime()).toBeGreaterThanOrEqual(
          before.getTime(),
        );
      });
    });

    describe("when called by a non-admin user", () => {
      it("returns a FORBIDDEN tRPC error", async () => {
        const caller = createCaller({ email: "regular@example.com" });

        await expect(
          caller.deactivate({ userId: "user-1" }),
        ).rejects.toThrowError(
          expect.objectContaining({ code: "FORBIDDEN" }),
        );
      });
    });
  });

  describe("reactivate()", () => {
    describe("when called by a platform admin", () => {
      it("sets deactivatedAt to null", async () => {
        const caller = createCaller({ email: ADMIN_EMAIL });

        await caller.reactivate({ userId: "user-1" });

        expect(prismaUpdateMock).toHaveBeenCalledOnce();
        const callArgs = prismaUpdateMock.mock.calls[0]![0];
        expect(callArgs.where).toEqual({ id: "user-1" });
        expect(callArgs.data.deactivatedAt).toBeNull();
      });
    });

    describe("when called by a non-admin user", () => {
      it("returns a FORBIDDEN tRPC error", async () => {
        const caller = createCaller({ email: "regular@example.com" });

        await expect(
          caller.reactivate({ userId: "user-1" }),
        ).rejects.toThrowError(
          expect.objectContaining({ code: "FORBIDDEN" }),
        );
      });
    });
  });
});
