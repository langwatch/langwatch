import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/server/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    organization: { findFirst: vi.fn() },
    session: { findUnique: vi.fn() },
    account: { create: vi.fn(), deleteMany: vi.fn() },
    organizationUser: { create: vi.fn() },
  },
}));

vi.mock("../../../ee/admin/sessionHandler", () => ({
  handleAdminImpersonationSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../utils/auth", () => ({
  getNextAuthSessionToken: vi.fn().mockReturnValue(null),
}));

vi.mock("../../utils/logger/server", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("../../utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

vi.mock("~/env.mjs", () => ({
  env: {
    NEXTAUTH_PROVIDER: "email",
  },
}));

import { prisma } from "~/server/db";
import { authOptions } from "../auth";

const prismaMock = prisma as any;

describe("NextAuth signIn callback", () => {
  let signInCallback: (params: { user: any; account: any }) => Promise<boolean | string>;

  beforeEach(() => {
    vi.clearAllMocks();

    const options = authOptions({} as any);
    signInCallback = options.callbacks!.signIn! as any;

    // Default: no SSO domain match
    prismaMock.organization.findFirst.mockResolvedValue(null);
  });

  describe("when the user account is deactivated", () => {
    it("returns false, denying login", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "deactivated@example.com",
        deactivatedAt: new Date("2025-01-01"),
      });

      const result = await signInCallback({
        user: { id: "user-1", email: "deactivated@example.com" },
        account: { provider: "credentials" },
      });

      expect(result).toBe(false);
    });
  });

  describe("when the user account is active", () => {
    it("does not block the sign-in", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: "user-2",
        email: "active@example.com",
        deactivatedAt: null,
      });

      const result = await signInCallback({
        user: { id: "user-2", email: "active@example.com" },
        account: { provider: "credentials" },
      });

      expect(result).toBe(true);
    });
  });

  describe("when the user does not exist yet", () => {
    it("does not block the sign-in", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const result = await signInCallback({
        user: { id: "new-user", email: "new@example.com" },
        account: { provider: "credentials" },
      });

      expect(result).toBe(true);
    });
  });
});
