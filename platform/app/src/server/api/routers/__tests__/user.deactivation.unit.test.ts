import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakePrisma,
  type FakePrisma,
} from "../../../users/__tests__/fake-prisma";
import { createInnerTRPCContext } from "../../trpc";
import { userRouter } from "../user";

vi.mock("../../../../env.mjs", () => ({
  env: { NEXTAUTH_PROVIDER: "email" },
}));

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../../../ee/admin/isAdmin", () => ({
  isAdmin: vi.fn(
    ({ email }: { email: string }) => email === "admin@example.com",
  ),
}));

// An App carrying no Redis, so the revoke helper the deactivation path calls
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
  let prisma: FakePrisma;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createFakePrisma({
      users: [
        { id: "user-1", deactivatedAt: null },
        { id: "caller-1", deactivatedAt: null },
      ],
    });
  });

  const deactivatedAtOf = (id: string) =>
    prisma.user.rows.find((row) => row.id === id)?.deactivatedAt;

  const createCaller = (email = "admin@example.com") => {
    const ctx = createInnerTRPCContext({
      session: {
        user: { id: "caller-1", name: "Caller", email },
        expires: "2099-01-01",
      },
    });
    (ctx as any).prisma = prisma;
    return userRouter.createCaller(ctx);
  };

  describe("deactivate()", () => {
    describe("when called", () => {
      /** @scenario user.deactivate sets deactivatedAt on the user */
      it("sets deactivatedAt on the user", async () => {
        const before = new Date();
        await createCaller().deactivate({ userId: "user-1" });

        const deactivatedAt = deactivatedAtOf("user-1");
        expect(deactivatedAt).toBeInstanceOf(Date);
        expect((deactivatedAt as Date).getTime()).toBeGreaterThanOrEqual(
          before.getTime(),
        );
      });
    });

    describe("when called by a non-admin", () => {
      it("allows users to deactivate themselves", async () => {
        await createCaller("member@example.com").deactivate({
          userId: "caller-1",
        });

        expect(deactivatedAtOf("caller-1")).toBeInstanceOf(Date);
      });

      it("rejects the request", async () => {
        await expect(
          createCaller("member@example.com").deactivate({ userId: "user-1" }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        expect(deactivatedAtOf("user-1")).toBeNull();
      });
    });
  });

  describe("reactivate()", () => {
    describe("when called", () => {
      /** @scenario user.reactivate clears deactivatedAt on the user */
      it("clears deactivatedAt to null", async () => {
        prisma.user.rows[0]!.deactivatedAt = new Date();

        await createCaller().reactivate({ userId: "user-1" });

        expect(deactivatedAtOf("user-1")).toBeNull();
      });
    });

    describe("when called by a non-admin", () => {
      it("rejects the request", async () => {
        await expect(
          createCaller("member@example.com").reactivate({ userId: "user-1" }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        expect(deactivatedAtOf("user-1")).toBeNull();
      });
    });
  });
});
