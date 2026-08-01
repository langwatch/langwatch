/**
 * Unit tests for userRouter.register (email-mode signup).
 *
 * Verifies:
 * - The signed_up analytics event fires once for a successful registration
 * - No event fires when the user already exists
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { userRouter } from "../user";

vi.mock("../../../../env.mjs", () => ({
  env: { NEXTAUTH_PROVIDER: "email" },
}));

const { mockTrackServerEvent } = vi.hoisted(() => ({
  mockTrackServerEvent: vi.fn(),
}));

vi.mock("~/server/posthog", () => ({
  trackServerEvent: mockTrackServerEvent,
}));

vi.mock("~/server/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true }),
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

describe("userRouter.register()", () => {
  let userFindUniqueMock: ReturnType<typeof vi.fn>;
  let userCreateMock: ReturnType<typeof vi.fn>;
  let accountCreateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock = vi.fn().mockResolvedValue(null);
    userCreateMock = vi
      .fn()
      .mockResolvedValue({ id: "user-1", name: "Alice", email: "a@x.com" });
    accountCreateMock = vi.fn().mockResolvedValue(undefined);
  });

  const createCaller = () => {
    const ctx = createInnerTRPCContext({ session: null });
    const prismaMock = {
      user: { findUnique: userFindUniqueMock, create: userCreateMock },
      account: { create: accountCreateMock },
      $transaction: vi.fn(
        async (cb: (tx: unknown) => unknown) =>
          await cb({
            user: { create: userCreateMock },
            account: { create: accountCreateMock },
          }),
      ),
    };
    (ctx as any).prisma = prismaMock;
    return userRouter.createCaller(ctx);
  };

  describe("when registration succeeds", () => {
    /** @scenario Email-mode registration tracks the PostHog signed_up milestone exactly once */
    it("tracks the signed_up analytics event with the new user id", async () => {
      const result = await createCaller().register({
        name: "Alice",
        email: "a@x.com",
        password: "supersecret",
      });

      expect(result).toEqual({ id: "user-1" });
      expect(mockTrackServerEvent).toHaveBeenCalledTimes(1);
      expect(mockTrackServerEvent).toHaveBeenCalledWith({
        userId: "user-1",
        event: "signed_up",
      });
    });
  });

  describe("when the user already exists", () => {
    /** @scenario A rejected registration tracks no PostHog signed_up milestone */
    it("does not track signed_up", async () => {
      userFindUniqueMock.mockResolvedValue({ id: "user-1" });

      await expect(
        createCaller().register({
          name: "Alice",
          email: "a@x.com",
          password: "supersecret",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(mockTrackServerEvent).not.toHaveBeenCalled();
    });
  });
});
