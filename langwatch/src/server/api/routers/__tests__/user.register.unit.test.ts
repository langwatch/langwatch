/**
 * Unit tests for userRouter.register.
 *
 * Covers the PostHog signed_up milestone, and the ADR-027 provider coercion:
 * see specs/licensing/sso-license-gating.feature. The signup page registers
 * through this tRPC mutation (not better-auth's /sign-up/email), so the
 * email-mode coercion must apply here too: on a denied SSO-capable deployment
 * the resolved provider is "email" and registration must work, while a
 * licensed SSO deployment keeps refusing direct registration.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { userRouter } from "../user";

// The raw env names an IdP; what this route keys off is the RESOLVED provider
// below, so the two can disagree and that is the point of the coercion tests.
vi.mock("../../../../env.mjs", () => ({
  env: { NEXTAUTH_PROVIDER: "auth0", BASE_HOST: "http://localhost:5560" },
}));

const { mockTrackServerEvent } = vi.hoisted(() => ({
  mockTrackServerEvent: vi.fn(),
}));

vi.mock("~/server/posthog", () => ({
  trackServerEvent: mockTrackServerEvent,
}));

vi.mock("~/server/redis", () => ({ connection: undefined }));

vi.mock("~/server/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

// The tRPC error-audit middleware writes through the real prisma singleton, so
// a mutation that throws here reaches a live client and fails with a Prisma
// validation error that masks the assertion. Shard-order dependent: on its own
// this file passes, batched with a test that initializes the app singleton it
// does not.
vi.mock("~/server/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/utils/getClientIp", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

const { resolveAuthProviderMock } = vi.hoisted(() => ({
  resolveAuthProviderMock: vi.fn(),
}));
vi.mock("~/server/sso/sso-gate", () => ({
  resolveAuthProvider: resolveAuthProviderMock,
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
    // Most cases here are the coerced/email-mode deployment; the licensed-SSO
    // case overrides this.
    resolveAuthProviderMock.mockResolvedValue("email");
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

  describe("given an SSO-capable deployment where the gate DENIES (coerced email mode)", () => {
    /** @scenario A fresh unlicensed deployment bootstraps via email signup */
    it("registers the user through the signup form's tRPC path", async () => {
      resolveAuthProviderMock.mockResolvedValue("email");

      await expect(
        createCaller().register({
          name: "Operator",
          email: "operator@example.com",
          password: "password-123",
        }),
      ).resolves.toMatchObject({ id: "user-1" });
      expect(userCreateMock).toHaveBeenCalled();
    });
  });

  describe("given an SSO-capable deployment where the gate ALLOWS", () => {
    /** @scenario A licensed deployment cannot mint password accounts */
    it("refuses direct registration", async () => {
      resolveAuthProviderMock.mockResolvedValue("auth0");

      await expect(
        createCaller().register({
          name: "Attacker",
          email: "attacker@example.com",
          password: "password-123",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(userCreateMock).not.toHaveBeenCalled();
    });
  });
});
