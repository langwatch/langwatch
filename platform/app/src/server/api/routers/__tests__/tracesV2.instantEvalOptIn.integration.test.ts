/**
 * @vitest-environment node
 *
 * `tracesV2.instantEval.access` and `.enable` through the real tRPC router:
 * the server half of the opt-in authorization. Session, RBAC and the
 * organization lookup run against the real test database. Only the
 * deployment and the plan are stated, so the organization is one the switch
 * is offered to and the member's own authority is what decides.
 *
 * Spec: specs/instant-evals/instant-eval-opt-in.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { seedRoleBinding } from "~/test-utils/authz-seeds";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

wireDefaultTestApp();

// A hosted self-serve organization, so the switch is offered and only the
// caller's `organization:manage` authority separates the two answers. The
// plan is stated per describe, so one can turn the organization enterprise.
const plan = vi.hoisted(() => ({ type: "FREE" }));
vi.mock("~/server/app-layer/instant-evals/opt-in", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("~/server/app-layer/instant-evals/opt-in")
    >();
  const hostedSelfServe = {
    isSaas: () => true,
    planTypeOf: async () => plan.type,
  };
  return {
    ...original,
    instantEvalOptInOffer: (
      args: Parameters<typeof original.instantEvalOptInOffer>[0],
    ) => original.instantEvalOptInOffer({ ...args, ...hostedSelfServe }),
    switchInstantEvalsOn: (
      args: Parameters<typeof original.switchInstantEvalsOn>[0],
    ) => original.switchInstantEvalsOn({ ...args, ...hostedSelfServe }),
  };
});

const ns = `ieoi-${nanoid(8)}`;
const ORG_ID = `org-${ns}`;
const OTHER_ORG_ID = `org-other-${ns}`;
const TEAM_ID = `team-${ns}`;
const PROJECT_ID = `project-${ns}`;
const ADMIN_ID = `usr-adm-${ns}`;
const MEMBER_ID = `usr-mem-${ns}`;

function callerFor(userId: string) {
  return appRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: { id: userId, email: `${userId}@example.com` },
        expires: new Date(Date.now() + 3_600_000).toISOString(),
      } as never,
    }),
  );
}

async function optInOf(organizationId: string) {
  return await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { instantEvalsEnabledAt: true, instantEvalsEnabledByUserId: true },
  });
}

describe("tracesV2.instantEval opt-in procedures", () => {
  beforeAll(async () => {
    await prisma.organization.createMany({
      data: [
        { id: ORG_ID, name: "Opt-in Org", slug: `optin-${ns}` },
        { id: OTHER_ORG_ID, name: "Other Org", slug: `other-${ns}` },
      ],
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: "Opt-in Team",
        slug: `team-${ns}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: "Opt-in Project",
        slug: `project-${ns}`,
        apiKey: `key-${ns}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "test-framework",
      },
    });
    await prisma.user.createMany({
      data: [
        { id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "Admin" },
        { id: MEMBER_ID, email: `${MEMBER_ID}@example.com`, name: "Member" },
      ],
    });
    await prisma.organizationUser.createMany({
      data: [
        {
          organizationId: ORG_ID,
          userId: ADMIN_ID,
          role: OrganizationUserRole.ADMIN,
        },
        {
          organizationId: ORG_ID,
          userId: MEMBER_ID,
          role: OrganizationUserRole.MEMBER,
        },
      ],
    });
    await seedRoleBinding(prisma, {
      organizationId: ORG_ID,
      userId: ADMIN_ID,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: ORG_ID,
    });
    await seedRoleBinding(prisma, {
      organizationId: ORG_ID,
      userId: MEMBER_ID,
      role: TeamUserRole.MEMBER,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: TEAM_ID,
    });
  });

  afterAll(async () => {
    const orgIds = [ORG_ID, OTHER_ORG_ID];
    await prisma.auditLog.deleteMany({
      where: { userId: { in: [ADMIN_ID, MEMBER_ID] } },
    });
    await prisma.grant.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.roleBinding.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: orgIds } },
    });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.user.deleteMany({
      where: { id: { in: [ADMIN_ID, MEMBER_ID] } },
    });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  describe("given a member without organization:manage", () => {
    it("is offered a word with an organization admin, not the switch", async () => {
      const result = await callerFor(MEMBER_ID).tracesV2.instantEval.access({
        projectId: PROJECT_ID,
      });
      expect(result).toEqual({
        released: false,
        offer: "ask_admin",
        viaConnect: false,
      });
    });

    it("is refused the switch, and nothing is recorded", async () => {
      await expect(
        callerFor(MEMBER_ID).tracesV2.instantEval.enable({
          projectId: PROJECT_ID,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await optInOf(ORG_ID)).toEqual({
        instantEvalsEnabledAt: null,
        instantEvalsEnabledByUserId: null,
      });
    });
  });

  describe("given an organization admin", () => {
    it("is offered the switch", async () => {
      const result = await callerFor(ADMIN_ID).tracesV2.instantEval.access({
        projectId: PROJECT_ID,
      });
      expect(result).toEqual({
        released: false,
        offer: "enable",
        viaConnect: false,
      });
    });

    it("switches on the project's own organization and no other", async () => {
      const result = await callerFor(ADMIN_ID).tracesV2.instantEval.enable({
        projectId: PROJECT_ID,
      });
      // The access read's own shape, since the popover writes it into that
      // cache; the hosted switch never judges through Connect.
      expect(result).toEqual({
        released: true,
        offer: "enable",
        viaConnect: false,
      });

      const own = await optInOf(ORG_ID);
      expect(own.instantEvalsEnabledAt).toBeInstanceOf(Date);
      expect(own.instantEvalsEnabledByUserId).toBe(ADMIN_ID);
      expect(await optInOf(OTHER_ORG_ID)).toEqual({
        instantEvalsEnabledAt: null,
        instantEvalsEnabledByUserId: null,
      });

      const after = await callerFor(MEMBER_ID).tracesV2.instantEval.access({
        projectId: PROJECT_ID,
      });
      expect(after.released).toBe(true);
    });

    it("leaves one audit row that names the organization it switched on", async () => {
      const rows = await prisma.auditLog.findMany({
        where: {
          userId: ADMIN_ID,
          action: "tracesV2.instantEval.enable",
        },
        select: {
          organizationId: true,
          projectId: true,
          targetKind: true,
          targetId: true,
          error: true,
        },
      });
      expect(rows).toEqual([
        {
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          targetKind: "organization",
          targetId: ORG_ID,
          error: null,
        },
      ]);
    });
  });

  describe("given an enterprise organization", () => {
    beforeAll(() => {
      plan.type = "ENTERPRISE";
    });
    afterAll(() => {
      plan.type = "FREE";
    });

    it("refuses the admin's switch and leaves one audit row naming the organization and the refusal", async () => {
      await expect(
        callerFor(ADMIN_ID).tracesV2.instantEval.enable({
          projectId: PROJECT_ID,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const failed = await prisma.auditLog.findMany({
        where: {
          userId: ADMIN_ID,
          action: "tracesV2.instantEval.enable",
          error: { not: null },
        },
        select: {
          organizationId: true,
          projectId: true,
          targetKind: true,
          targetId: true,
          error: true,
        },
      });
      expect(failed).toEqual([
        {
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          targetKind: "organization",
          targetId: ORG_ID,
          error: expect.stringContaining("Contact us"),
        },
      ]);
    });
  });
});
