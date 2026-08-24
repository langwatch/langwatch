/**
 * @vitest-environment node
 *
 * Unit tests for the featureFlag.isEnabled tRPC procedure.
 *
 * The procedure takes an optional `organizationId` and `projectId` from the
 * client and hands both to the flag store, which evaluates targeting rules
 * against them. Neither is a resource being read — the response is one boolean
 * — so nothing about them looks like a permission check, and for a long time
 * nothing checked them at all. That is the hole: an authenticated user could
 * name any organization id and read that tenant's flag state one call at a
 * time, learning e.g. which organizations have governance turned on.
 *
 * The plural sibling (isEnabledForAnyOrganization) has filtered its input
 * against real memberships since it shipped. This singular one, sitting in the
 * same file, never did.
 *
 * The fix drops an id the caller is not a current member of and evaluates the
 * flag without it, rather than throwing, so the response cannot tell "not a
 * member" apart from "flag off". A project is reached through the organization
 * that owns its team — the same boundary every project permission path fails
 * closed on — and a seat an admin disabled does not count as membership.
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
const OWN_ORG = "org_own";
const FOREIGN_ORG = "org_foreign";
const OWN_PROJECT = "project_own";
const FOREIGN_PROJECT = "project_foreign";
const UNKNOWN_PROJECT = "project_does_not_exist";
const FLAG = "release_ui_ai_governance_enabled" as const;

/** Which organization owns which project, for the team lookup. */
const PROJECT_OWNER: Record<string, string> = {
  [OWN_PROJECT]: OWN_ORG,
  [FOREIGN_PROJECT]: FOREIGN_ORG,
};

/**
 * `memberOf` is every organization with an `OrganizationUser` row for the
 * user; `disabledIn` is the subset whose seat an admin has turned off. The row
 * outlives that, so a check that only asks whether the row exists still reads
 * a disabled seat as membership.
 */
function buildMockPrisma({
  memberOf,
  disabledIn = new Set<string>(),
}: {
  memberOf: Set<string>;
  disabledIn?: Set<string>;
}) {
  return {
    organizationUser: {
      findFirst: vi.fn(({ where }: any) => {
        const { userId, organizationId } = where;
        if (userId !== USER_ID || !memberOf.has(organizationId)) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          role: "MEMBER",
          disabledAt: disabledIn.has(organizationId) ? new Date(0) : null,
        });
      }),
    },
    project: {
      findUnique: vi.fn(({ where }: any) => {
        const organizationId = PROJECT_OWNER[where.id];
        // Both fields the real `select` asks for: the shared tenancy resolve
        // refuses a project whose team it cannot name, so a mock that returns
        // only the organization would drop every project id and make these
        // tests pass for the wrong reason.
        return Promise.resolve(
          organizationId
            ? { team: { id: `team_of_${where.id}`, organizationId } }
            : null,
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

/** The targeting options the flag service was actually handed. */
function targetingPassedToService() {
  const opts = mockIsEnabled.mock.calls[0]?.[1] as
    | { projectId?: string; organizationId?: string }
    | undefined;
  return {
    projectId: opts?.projectId,
    organizationId: opts?.organizationId,
  };
}

describe("featureFlag.isEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEnabled.mockResolvedValue(false);
  });

  describe("when the caller targets an organization they belong to", () => {
    it("evaluates the flag against it", async () => {
      const caller = buildCaller(
        buildMockPrisma({ memberOf: new Set([OWN_ORG]) }),
      );
      mockIsEnabled.mockResolvedValue(true);

      const result = await caller.isEnabled({
        flag: FLAG,
        organizationId: OWN_ORG,
      });

      expect(result).toEqual({ enabled: true });
      expect(targetingPassedToService().organizationId).toBe(OWN_ORG);
    });
  });

  describe("when the caller targets an organization they do not belong to", () => {
    /** @scenario The single-flag check refuses to be targeted by someone else's ids */
    it("evaluates the flag without that organization, never passing it on", async () => {
      const caller = buildCaller(
        buildMockPrisma({ memberOf: new Set([OWN_ORG]) }),
      );

      await caller.isEnabled({ flag: FLAG, organizationId: FOREIGN_ORG });

      expect(mockIsEnabled).toHaveBeenCalledTimes(1);
      expect(targetingPassedToService().organizationId).toBeUndefined();
    });

    it("answers exactly as it does for a member whose flag is off, so the response cannot oracle membership", async () => {
      mockIsEnabled.mockResolvedValue(false);

      const outsider = await buildCaller(
        buildMockPrisma({ memberOf: new Set([OWN_ORG]) }),
      ).isEnabled({ flag: FLAG, organizationId: FOREIGN_ORG });
      const member = await buildCaller(
        buildMockPrisma({ memberOf: new Set([OWN_ORG]) }),
      ).isEnabled({ flag: FLAG, organizationId: OWN_ORG });

      expect(outsider).toEqual(member);
      expect(outsider).toEqual({ enabled: false });
    });
  });

  describe("when the caller's seat in the targeted organization is disabled", () => {
    /** @scenario A disabled seat is not a membership for flag targeting */
    it("drops the organization, though the membership row still exists", async () => {
      const caller = buildCaller(
        buildMockPrisma({
          memberOf: new Set([OWN_ORG]),
          disabledIn: new Set([OWN_ORG]),
        }),
      );

      await caller.isEnabled({ flag: FLAG, organizationId: OWN_ORG });

      expect(targetingPassedToService().organizationId).toBeUndefined();
    });
  });

  describe("when the caller targets a project", () => {
    it("keeps one owned by an organization they belong to", async () => {
      const caller = buildCaller(
        buildMockPrisma({ memberOf: new Set([OWN_ORG]) }),
      );

      await caller.isEnabled({ flag: FLAG, projectId: OWN_PROJECT });

      expect(targetingPassedToService().projectId).toBe(OWN_PROJECT);
    });

    it("drops one owned by an organization they do not belong to", async () => {
      const caller = buildCaller(
        buildMockPrisma({ memberOf: new Set([OWN_ORG]) }),
      );

      await caller.isEnabled({ flag: FLAG, projectId: FOREIGN_PROJECT });

      expect(targetingPassedToService().projectId).toBeUndefined();
    });

    it("drops one that does not exist, rather than passing the id through", async () => {
      const caller = buildCaller(
        buildMockPrisma({ memberOf: new Set([OWN_ORG]) }),
      );

      await caller.isEnabled({ flag: FLAG, projectId: UNKNOWN_PROJECT });

      expect(targetingPassedToService().projectId).toBeUndefined();
    });
  });

  describe("when both identifiers name the same organization the caller is outside of", () => {
    /**
     * `scopeLineageGuard` already refuses a request whose scope ids resolve to
     * DIFFERENT organizations, so a project of ours paired with someone else's
     * org id never reaches the resolver. It says nothing about whose ids these
     * are, though: a matched pair from one foreign organization satisfies it
     * completely. That pair is what the membership filter is for.
     */
    it("drops both, so a consistent pair buys the caller nothing", async () => {
      const caller = buildCaller(
        buildMockPrisma({ memberOf: new Set([OWN_ORG]) }),
      );

      await caller.isEnabled({
        flag: FLAG,
        projectId: FOREIGN_PROJECT,
        organizationId: FOREIGN_ORG,
      });

      expect(mockIsEnabled).toHaveBeenCalledTimes(1);
      expect(targetingPassedToService()).toEqual({
        projectId: undefined,
        organizationId: undefined,
      });
    });
  });

  describe("when the caller sends no targeting identifiers", () => {
    it("evaluates the flag without reading any membership", async () => {
      const prisma = buildMockPrisma({ memberOf: new Set([OWN_ORG]) });
      const caller = buildCaller(prisma);

      const result = await caller.isEnabled({ flag: FLAG });

      expect(result).toEqual({ enabled: false });
      expect(prisma.organizationUser.findFirst).not.toHaveBeenCalled();
      expect(prisma.project.findUnique).not.toHaveBeenCalled();
      expect(mockIsEnabled).toHaveBeenCalledTimes(1);
    });
  });
});
