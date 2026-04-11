import { describe, it, expect, vi, beforeEach } from "vitest";
import { userRouter } from "../user";
import { createInnerTRPCContext } from "../../trpc";

vi.mock("../../../../env.mjs", () => ({
  env: { NEXTAUTH_PROVIDER: "email" },
}));

vi.mock("../../../auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

// Mock the redis connection so the revoke helper called by
// UserService.deactivate doesn't try to talk to a real Redis from a unit test.
vi.mock("~/server/redis", () => ({ connection: undefined }));

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
