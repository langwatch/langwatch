import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { apiKeyRouter } from "../apiKey";

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "mock-nano-id"),
  customAlphabet: vi.fn(
    () => () => "mock48characterrandomstringforapikeygeneration",
  ),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    skipPermissionCheck:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

const ORG_ID = "org_1";
const OTHER_ORG_ID = "org_2";
const USER_ID = "user_1";
const API_KEY_ID = "key_abc123";

/**
 * @param membership row returned for the caller's org membership lookup, or
 *   null to model a caller who is not in the organization.
 * @param apiKeyRow row the scoped name lookup finds, or null for an id that is
 *   unknown or belongs to another organization.
 */
function buildMockPrisma({
  membership = { userId: USER_ID },
  apiKeyRow = null,
}: {
  membership?: { userId: string } | null;
  apiKeyRow?: { name: string; revokedAt: Date | null } | null;
} = {}) {
  return {
    organizationUser: {
      findFirst: vi.fn().mockResolvedValue(membership),
    },
    apiKey: {
      findFirst: vi.fn().mockResolvedValue(apiKeyRow),
    },
  } as unknown as PrismaClient;
}

function callerFor(prisma: PrismaClient) {
  const ctx = createInnerTRPCContext({
    session: { user: { id: USER_ID }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  ctx.prisma = prisma;
  return apiKeyRouter.createCaller(ctx);
}

describe("apiKey.nameById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a caller who is a member of the organization", () => {
    /** @scenario Any organization member can name a key they can already see */
    it("returns the key's name", async () => {
      const prisma = buildMockPrisma({
        apiKeyRow: { name: "Claude Code on the laptop", revokedAt: null },
      });

      const result = await callerFor(prisma).nameById({
        organizationId: ORG_ID,
        apiKeyId: API_KEY_ID,
      });

      expect(result).toEqual({
        name: "Claude Code on the laptop",
        revoked: false,
      });
    });

    // The drawer shows this to anyone who can read the trace, so the payload
    // must stay the two display fields and never widen into the key row.
    it("returns nothing beyond the name and revoked flag", async () => {
      const prisma = buildMockPrisma({
        apiKeyRow: { name: "ACME service key", revokedAt: null },
      });

      const result = await callerFor(prisma).nameById({
        organizationId: ORG_ID,
        apiKeyId: API_KEY_ID,
      });

      expect(Object.keys(result ?? {}).sort()).toEqual(["name", "revoked"]);
    });

    it("selects only the display columns from the database", async () => {
      const prisma = buildMockPrisma({
        apiKeyRow: { name: "ACME service key", revokedAt: null },
      });

      await callerFor(prisma).nameById({
        organizationId: ORG_ID,
        apiKeyId: API_KEY_ID,
      });

      const call = (
        prisma.apiKey.findFirst as unknown as ReturnType<typeof vi.fn>
      ).mock.calls[0]![0];
      expect(call.select).toEqual({ name: true, revokedAt: true });
    });

    it("scopes the lookup to the caller's organization", async () => {
      const prisma = buildMockPrisma({
        apiKeyRow: { name: "ACME service key", revokedAt: null },
      });

      await callerFor(prisma).nameById({
        organizationId: ORG_ID,
        apiKeyId: API_KEY_ID,
      });

      const call = (
        prisma.apiKey.findFirst as unknown as ReturnType<typeof vi.fn>
      ).mock.calls[0]![0];
      expect(call.where).toEqual({ id: API_KEY_ID, organizationId: ORG_ID });
    });
  });

  describe("given a key that has been revoked", () => {
    /** @scenario A revoked key still resolves to its name */
    it("still resolves to the name, flagged as revoked", async () => {
      const prisma = buildMockPrisma({
        apiKeyRow: {
          name: "Retired ingestion key",
          revokedAt: new Date("2026-01-01"),
        },
      });

      const result = await callerFor(prisma).nameById({
        organizationId: ORG_ID,
        apiKeyId: API_KEY_ID,
      });

      expect(result).toEqual({ name: "Retired ingestion key", revoked: true });
    });
  });

  describe("given a caller who is not a member of the organization", () => {
    /** @scenario A non-member cannot name a key in an organization they are outside */
    it("is rejected before any key lookup happens", async () => {
      const prisma = buildMockPrisma({ membership: null });

      await expect(
        callerFor(prisma).nameById({
          organizationId: OTHER_ORG_ID,
          apiKeyId: API_KEY_ID,
        }),
      ).rejects.toThrow();

      expect(prisma.apiKey.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("given an id that does not resolve inside the organization", () => {
    // An unknown id and one belonging to another organization must be
    // indistinguishable, so probing cannot confirm a key exists elsewhere.
    /** @scenario An unresolvable key id returns nothing rather than an error */
    it("returns null", async () => {
      const prisma = buildMockPrisma({ apiKeyRow: null });

      const result = await callerFor(prisma).nameById({
        organizationId: ORG_ID,
        apiKeyId: "key_from_another_org",
      });

      expect(result).toBeNull();
    });
  });
});
