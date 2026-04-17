/**
 * @vitest-environment node
 *
 * Integration test reproducing the production bug where a user invited as a MEMBER
 * via the new RoleBinding flow logs in and sees "You are not part of any team in this
 * organization" despite having TEAM- and ORGANIZATION-scoped RoleBindings.
 *
 * Data state under test (mirrors the production case):
 *  - OrganizationUser: role=MEMBER
 *  - RoleBinding #1: scopeType=ORGANIZATION, role=MEMBER
 *  - RoleBinding #2: scopeType=TEAM, role=MEMBER
 *  - No TeamUser row
 *
 * Exercises `organization.getAll` which should enrich team.members via
 * `enrichTeamWithRoleBindings` in `organization.service.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { createTestApp } from "../../../app-layer/presets";
import { globalForApp, resetApp } from "../../../app-layer/app";
import { OrganizationService } from "../../../app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "../../../app-layer/organizations/repositories/organization.prisma.repository";
import { PromptTagRepository } from "../../../prompt-config/repositories/prompt-tag.repository";
import { traced } from "../../../app-layer/tracing";

describe("organization.getAll — team membership enrichment via RoleBinding", () => {
  const testNamespace = `getall-enrich-${nanoid(8)}`;
  let organizationId: string;
  let teamId: string;
  let memberUserId: string;
  let memberCaller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    // Create test organization
    const organization = await prisma.organization.create({
      data: {
        name: "Enrichment Test Org",
        slug: `--test-enrich-org-${testNamespace}`,
      },
    });
    organizationId = organization.id;

    // Create test team
    const team = await prisma.team.create({
      data: {
        name: "Enrichment Test Team",
        slug: `--test-enrich-team-${testNamespace}`,
        organizationId,
      },
    });
    teamId = team.id;

    // Create member user
    const memberUser = await prisma.user.create({
      data: {
        email: `enrich-member-${testNamespace}@test.com`,
        name: "Enrich Member",
      },
    });
    memberUserId = memberUser.id;

    // OrganizationUser: role=MEMBER
    await prisma.organizationUser.create({
      data: {
        userId: memberUserId,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    });

    // RoleBinding #1: scopeType=ORGANIZATION, role=MEMBER
    await prisma.roleBinding.create({
      data: {
        id: `rb-org-${nanoid(8)}`,
        organizationId,
        userId: memberUserId,
        role: TeamUserRole.MEMBER,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });

    // RoleBinding #2: scopeType=TEAM, role=MEMBER
    await prisma.roleBinding.create({
      data: {
        id: `rb-team-${nanoid(8)}`,
        organizationId,
        userId: memberUserId,
        role: TeamUserRole.MEMBER,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
      },
    });

    // Deliberately NO TeamUser row — this is the bug-reproducing state.

    // Wire App singleton with a REAL prisma-backed OrganizationService so
    // getAllForUser runs against the DB. The service is wrapped with `traced()`
    // to mirror production exactly — previously the test missed a bug where
    // the tracing proxy turned synchronous service methods into Promises.
    // createTestApp's default uses NullOrganizationRepository which would
    // return no orgs and mask the behavior under test.
    globalForApp.__langwatch_app = createTestApp({
      organizations: traced(
        new OrganizationService(
          new PrismaOrganizationRepository(prisma),
          new PromptTagRepository(prisma),
        ),
        "OrganizationService",
      ),
    });

    const memberCtx = createInnerTRPCContext({
      session: {
        user: { id: memberUserId },
        expires: "1",
      },
    });
    memberCaller = appRouter.createCaller(memberCtx);
  });

  afterAll(async () => {
    resetApp();

    await prisma.roleBinding.deleteMany({ where: { organizationId } });
    await prisma.teamUser.deleteMany({ where: { teamId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.team.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({
      where: { email: `enrich-member-${testNamespace}@test.com` },
    });
  });

  describe("given a user with ORG- and TEAM-scoped RoleBindings but no TeamUser row", () => {
    describe("when organization.getAll is called", () => {
      it("returns the organization for the user", async () => {
        const result = await memberCaller.organization.getAll({});

        // Sanity: the user's org must be present in the response
        const org = result.find((o) => o.id === organizationId);
        expect(org).toBeDefined();
      });

      it("includes the team in organization.teams after enrichment", async () => {
        const result = await memberCaller.organization.getAll({});

        const org = result.find((o) => o.id === organizationId);
        expect(org).toBeDefined();

        // Because the org-level role is MEMBER (not ADMIN), the
        // `isExternal`-based filter path inside getAll would drop teams where
        // the user is not a member. We expect the enrichment to synthesize
        // membership so the team is retained.
        const teamInResponse = org!.teams.find((t) => t.id === teamId);
        expect(teamInResponse).toBeDefined();
      });

      it("synthesizes a team.members entry for the user via RoleBinding enrichment", async () => {
        const result = await memberCaller.organization.getAll({});

        const org = result.find((o) => o.id === organizationId);
        const teamInResponse = org?.teams.find((t) => t.id === teamId);

        // This is the core assertion — the bug reproduces if team.members
        // does NOT contain the user.
        const memberEntry = teamInResponse?.members.find(
          (m) => m.userId === memberUserId,
        );

        expect(memberEntry).toBeDefined();
        expect(memberEntry?.userId).toBe(memberUserId);
        expect(memberEntry?.role).toBe(TeamUserRole.MEMBER);
      });
    });
  });
});
