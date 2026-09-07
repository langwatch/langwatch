/**
 * @vitest-environment node
 *
 * Unit tests for the featureFlag.isEnabledForEachOrganization tRPC procedure.
 *
 * This is the variant every client surface actually calls (the workspace
 * switcher and the product shell), so the membership filtering and the
 * single-read membership resolution are pinned here as well as on the
 * `isEnabledForAnyOrganization` sibling — both procedures share one resolver.
 *
 * Organizations the caller does not belong to must be absent from the result
 * map entirely, never present as `false`: a `false` entry would tell the
 * caller the organization exists and they are not in it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { createInnerTRPCContext } from "../../trpc";
import { featureFlagRouter } from "../featureFlag";

const { mockIsEnabled } = vi.hoisted(() => ({
  mockIsEnabled: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
}));

vi.mock("../../../featureFlag", () => ({
  featureFlagService: { isEnabled: mockIsEnabled },
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
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

const USER_ID = "user_1";
const OWN_ORG_A = "org_own_a";
const OWN_ORG_B = "org_own_b";
const FOREIGN_ORG = "org_foreign";
const FLAG = "release_ui_ai_governance_enabled" as const;

/**
 * Memberships are resolved as a nested select off the person — one read for
 * the whole list, not one per organization — so the mock answers
 * `user.findUnique` and applies the nested `organizationId in:` filter itself.
 */
function buildMockPrisma({ memberOf }: { memberOf: Set<string> }) {
  return {
    user: {
      findUnique: vi.fn(({ where, select }: any) => {
        if (where.id !== USER_ID) return Promise.resolve(null);
        const requested: string[] =
          select.orgMemberships.where.organizationId.in;
        return Promise.resolve({
          orgMemberships: requested
            .filter((organizationId) => memberOf.has(organizationId))
            .map((organizationId) => ({ organizationId })),
        });
      }),
    },
  } as unknown as PrismaClient;
}

function buildCaller({ prisma }: { prisma: PrismaClient }) {
  const ctx = createInnerTRPCContext({
    session: { user: { id: USER_ID }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  ctx.prisma = prisma;
  return featureFlagRouter.createCaller(ctx);
}

describe("featureFlag.isEnabledForEachOrganization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEnabled.mockResolvedValue(false);
  });

  describe("when the user is a member of every input organization", () => {
    it("returns the flag state per organization", async () => {
      const caller = buildCaller({
        prisma: buildMockPrisma({ memberOf: new Set([OWN_ORG_A, OWN_ORG_B]) }),
      });
      mockIsEnabled.mockImplementation(
        async (_flag, opts: any) => opts.organizationId === OWN_ORG_B,
      );

      const result = await caller.isEnabledForEachOrganization({
        flag: FLAG,
        organizationIds: [OWN_ORG_A, OWN_ORG_B],
      });

      expect(result).toEqual({
        enabledByOrganizationId: {
          [OWN_ORG_A]: false,
          [OWN_ORG_B]: true,
        },
      });
    });
  });

  describe("when the input mixes member and non-member organizations", () => {
    it("omits non-member ids from the map rather than reporting them false", async () => {
      const caller = buildCaller({
        prisma: buildMockPrisma({ memberOf: new Set([OWN_ORG_A]) }),
      });
      mockIsEnabled.mockResolvedValue(true);

      const result = await caller.isEnabledForEachOrganization({
        flag: FLAG,
        organizationIds: [OWN_ORG_A, FOREIGN_ORG],
      });

      expect(result).toEqual({
        enabledByOrganizationId: { [OWN_ORG_A]: true },
      });
      expect(result.enabledByOrganizationId).not.toHaveProperty(FOREIGN_ORG);
      const evaluatedOrgIds = mockIsEnabled.mock.calls.map(
        ([, opts]: any) => opts.organizationId,
      );
      expect(evaluatedOrgIds).toEqual([OWN_ORG_A]);
    });
  });

  describe("when the caller belongs to many organizations", () => {
    it("resolves every membership in a single read", async () => {
      const organizationIds = Array.from(
        { length: 65 },
        (_, index) => `org_${index}`,
      );
      const prisma = buildMockPrisma({ memberOf: new Set(organizationIds) });
      const caller = buildCaller({ prisma });

      await caller.isEnabledForEachOrganization({
        flag: FLAG,
        organizationIds,
      });

      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the input list is empty", () => {
    it("returns an empty map without touching prisma or featureFlagService", async () => {
      const prisma = buildMockPrisma({ memberOf: new Set([OWN_ORG_A]) });
      const caller = buildCaller({ prisma });

      const result = await caller.isEnabledForEachOrganization({
        flag: FLAG,
        organizationIds: [],
      });

      expect(result).toEqual({ enabledByOrganizationId: {} });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockIsEnabled).not.toHaveBeenCalled();
    });
  });
});
