import { describe, it, expect, vi, beforeEach } from "vitest";
import { userRouter } from "../user";
import { createInnerTRPCContext } from "../../trpc";

vi.mock("../../../../env.mjs", () => ({
  env: { NEXTAUTH_PROVIDER: "email" },
}));

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

  const createCaller = () => {
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: "caller-1", name: "Caller", email: "any@example.com" },
        expires: "2099-01-01",
      },
    });
    (ctx as any).prisma = { user: { update: prismaUpdateMock } };
    return userRouter.createCaller(ctx);
  };

  describe("deactivate()", () => {
    describe("when called", () => {
      it("sets deactivatedAt on the user", async () => {
        const before = new Date();
        await createCaller().deactivate({ userId: "user-1" });

        const callArgs = prismaUpdateMock.mock.calls[0]![0];
        expect(callArgs.where).toEqual({ id: "user-1" });
        expect(callArgs.data.deactivatedAt).toBeInstanceOf(Date);
        expect(callArgs.data.deactivatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      });
    });
  });

  describe("reactivate()", () => {
    describe("when called", () => {
      it("clears deactivatedAt to null", async () => {
        await createCaller().reactivate({ userId: "user-1" });

        const callArgs = prismaUpdateMock.mock.calls[0]![0];
        expect(callArgs.where).toEqual({ id: "user-1" });
        expect(callArgs.data.deactivatedAt).toBeNull();
      });
    });
  });
});
