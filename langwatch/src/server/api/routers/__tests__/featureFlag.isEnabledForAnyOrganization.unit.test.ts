/**
 * @vitest-environment node
 *
 * Unit tests for the featureFlag.isEnabledForAnyOrganization tRPC procedure.
 *
 * The procedure receives a list of organization ids from the client. It MUST
 * intersect that list with the caller's actual `OrganizationUser` memberships
 * before evaluating the flag — otherwise an authenticated user could probe
 * the flag state of arbitrary organizations they don't belong to, which leaks
 * business information (e.g. which organizations use governance).
 *
 * Failure mode under test (pre-fix regression): the resolver fanned out
 * `featureFlagService.isEnabled` over every input id without a membership
 * check, so an attacker who knew (or guessed) another org's id could read
 * its flag state. The fix silently drops non-member ids and returns
 * `{ enabled: false }` when the filtered set is empty.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { featureFlagRouter } from "../featureFlag";
import { createInnerTRPCContext } from "../../trpc";

const { mockIsEnabled } = vi.hoisted(() => ({
  mockIsEnabled: vi.fn<(...args: unknown[]) => Promise<boolean>>(),
}));

vi.mock("../../../featureFlag", () => ({
  featureFlagService: { isEnabled: mockIsEnabled },
}));

vi.mock("~/utils/logger/server", () => ({
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

function buildMockPrisma(memberOf: Set<string>) {
  return {
    organizationUser: {
      findUnique: vi.fn(({ where }: any) => {
        const { userId, organizationId } = where.userId_organizationId;
        if (userId !== USER_ID) return Promise.resolve(null);
        return Promise.resolve(
          memberOf.has(organizationId) ? { organizationId } : null,
        );
      }),
    },
  } as unknown as PrismaClient;
}

function buildCaller(prisma: PrismaClient) {
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

describe("featureFlag.isEnabledForAnyOrganization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEnabled.mockResolvedValue(false);
  });

  describe("when the user is a member of every input organization", () => {
    it("evaluates the flag for those organizations", async () => {
      const caller = buildCaller(
        buildMockPrisma(new Set([OWN_ORG_A, OWN_ORG_B])),
      );
      mockIsEnabled.mockImplementation(async (_flag, opts: any) =>
        opts.organizationId === OWN_ORG_B,
      );

      const result = await caller.isEnabledForAnyOrganization({
        flag: FLAG,
        organizationIds: [OWN_ORG_A, OWN_ORG_B],
      });

      expect(result).toEqual({ enabled: true });
      const evaluatedOrgIds = mockIsEnabled.mock.calls.map(
        ([, opts]: any) => opts.organizationId,
      );
      expect(evaluatedOrgIds.sort()).toEqual([OWN_ORG_A, OWN_ORG_B].sort());
    });
  });

  describe("when the input mixes member and non-member organizations", () => {
    it("silently filters non-member ids before evaluating the flag", async () => {
      const caller = buildCaller(buildMockPrisma(new Set([OWN_ORG_A])));
      mockIsEnabled.mockImplementation(async (_flag, opts: any) =>
        opts.organizationId === OWN_ORG_A,
      );

      const result = await caller.isEnabledForAnyOrganization({
        flag: FLAG,
        organizationIds: [OWN_ORG_A, FOREIGN_ORG],
      });

      expect(result).toEqual({ enabled: true });
      const evaluatedOrgIds = mockIsEnabled.mock.calls.map(
        ([, opts]: any) => opts.organizationId,
      );
      expect(evaluatedOrgIds).toEqual([OWN_ORG_A]);
      expect(evaluatedOrgIds).not.toContain(FOREIGN_ORG);
    });
  });

  describe("when the user is a member of none of the input organizations", () => {
    it("returns enabled:false without evaluating the flag", async () => {
      const caller = buildCaller(buildMockPrisma(new Set()));

      const result = await caller.isEnabledForAnyOrganization({
        flag: FLAG,
        organizationIds: [FOREIGN_ORG, "org_other_foreign"],
      });

      expect(result).toEqual({ enabled: false });
      expect(mockIsEnabled).not.toHaveBeenCalled();
    });

    it("returns the same shape as a member with the flag off, so the response cannot oracle membership", async () => {
      const nonMemberCaller = buildCaller(buildMockPrisma(new Set()));
      const memberCaller = buildCaller(
        buildMockPrisma(new Set([OWN_ORG_A])),
      );
      mockIsEnabled.mockResolvedValue(false);

      const nonMemberResult =
        await nonMemberCaller.isEnabledForAnyOrganization({
          flag: FLAG,
          organizationIds: [FOREIGN_ORG],
        });
      const memberResult = await memberCaller.isEnabledForAnyOrganization({
        flag: FLAG,
        organizationIds: [OWN_ORG_A],
      });

      expect(nonMemberResult).toEqual(memberResult);
      expect(nonMemberResult).toEqual({ enabled: false });
    });
  });

  describe("when the input list is empty", () => {
    it("returns enabled:false without touching prisma or featureFlagService", async () => {
      const prisma = buildMockPrisma(new Set([OWN_ORG_A]));
      const caller = buildCaller(prisma);

      const result = await caller.isEnabledForAnyOrganization({
        flag: FLAG,
        organizationIds: [],
      });

      expect(result).toEqual({ enabled: false });
      expect(prisma.organizationUser.findUnique).not.toHaveBeenCalled();
      expect(mockIsEnabled).not.toHaveBeenCalled();
    });
  });
});
