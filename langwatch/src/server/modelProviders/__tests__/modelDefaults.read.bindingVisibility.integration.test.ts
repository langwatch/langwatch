/**
 * @vitest-environment node
 *
 * Real-Postgres integration coverage for Default Models read visibility
 * when a member's project access comes from ROLE BINDINGS only (the
 * post-migration membership shape: an ORGANIZATION-scope MEMBER binding
 * plus a TEAM-scope MEMBER binding, and NO legacy TeamUser rows).
 *
 * Regression: `batchScopePermissions` loaded role bindings only for the
 * scope ids it was directly asked about, so a project-permission batch
 * (which passes project ids + a projectTeamId map) never loaded the
 * TEAM-scoped bindings those projects inherit from. Members in this
 * shape got `false` for every project — the Default Models table
 * rendered "No default models configured" for them while an org-admin
 * teammate saw every row (customer report).
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { batchScopePermissions, hasProjectPermission } from "../../api/rbac";
import { prisma } from "../../db";
import { getDefaultModelsSnapshot } from "../modelDefaults.read";
import { ModelDefaultsRepository } from "../modelDefaults.repository";

describe("Default Models visibility for role-binding-only members (real DB)", () => {
  const ns = `mdcfg-vis-${nanoid(8)}`;

  let organizationId: string;
  let teamId: string;
  let otherTeamId: string;
  let projectAId: string;
  let projectBId: string;
  let otherTeamProjectId: string;
  let bindingMemberUserId: string;
  const configIds: string[] = [];

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Binding Visibility Org ${ns}`, slug: `--test-${ns}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: { name: `Team ${ns}`, slug: `--team-${ns}`, organizationId },
    });
    teamId = team.id;

    const otherTeam = await prisma.team.create({
      data: {
        name: `Other Team ${ns}`,
        slug: `--team-b-${ns}`,
        organizationId,
      },
    });
    otherTeamId = otherTeam.id;

    const mkProject = (slug: string, forTeamId: string) =>
      prisma.project.create({
        data: {
          name: `Project ${slug} ${ns}`,
          slug: `--proj-${slug}-${ns}`,
          teamId: forTeamId,
          language: "typescript",
          framework: "other",
          apiKey: `test-key-${slug}-${ns}`,
        },
      });
    projectAId = (await mkProject("a", teamId)).id;
    projectBId = (await mkProject("b", teamId)).id;
    otherTeamProjectId = (await mkProject("c", otherTeamId)).id;

    // The customer-report membership shape: org MEMBER row + MEMBER
    // role bindings at ORGANIZATION and TEAM scope, no TeamUser rows.
    const member = await prisma.user.create({
      data: {
        name: "Binding Member",
        email: `binding-member-${ns}@example.com`,
      },
    });
    bindingMemberUserId = member.id;
    await prisma.organizationUser.create({
      data: {
        userId: member.id,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    });
    await prisma.roleBinding.createMany({
      data: [
        {
          organizationId,
          userId: member.id,
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
        {
          organizationId,
          userId: member.id,
          role: TeamUserRole.MEMBER,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: teamId,
        },
      ],
    });

    // One PROJECT-scoped default-models config per team project —
    // mirrors the customer data (all configs project-scoped, none at
    // org or team scope).
    const repository = new ModelDefaultsRepository(prisma);
    for (const projectId of [projectAId, projectBId]) {
      const { id } = await repository.create({
        config: { FAST: "azure/gpt-5.4-mini" },
        scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
        authorId: null,
      });
      configIds.push(id);
    }
  });

  afterAll(async () => {
    await prisma.modelDefaultConfig.deleteMany({
      where: { id: { in: configIds } },
    });
    await prisma.roleBinding.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.user.deleteMany({ where: { id: bindingMemberUserId } });
    await prisma.project.deleteMany({
      where: { id: { in: [projectAId, projectBId, otherTeamProjectId] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [teamId, otherTeamId] } },
    });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  function memberCtx() {
    return {
      prisma,
      session: {
        user: {
          id: bindingMemberUserId,
          email: `binding-member-${ns}@example.com`,
          name: "Binding Member",
        },
        expires: "2099-01-01T00:00:00.000Z",
      } as any,
    };
  }

  describe("when the member's project access comes from a TEAM-scope binding", () => {
    /** @scenario Batch project check honours a team-scoped binding */
    /** @scenario Batch project check still denies projects of other teams */
    it("batch project check matches the per-project check", async () => {
      const perProject = await hasProjectPermission(
        memberCtx(),
        projectAId,
        "project:view",
      );
      expect(perProject).toBe(true);

      const batch = await batchScopePermissions(memberCtx(), {
        organizationId,
        teamIds: [],
        projectIds: [projectAId, projectBId, otherTeamProjectId],
        projectTeamId: {
          [projectAId]: teamId,
          [projectBId]: teamId,
          [otherTeamProjectId]: otherTeamId,
        },
        permission: "project:view",
      });

      expect(batch.projects.get(projectAId)).toBe(true);
      expect(batch.projects.get(projectBId)).toBe(true);
      // No binding covers the other team — its project stays denied.
      expect(batch.projects.get(otherTeamProjectId)).toBe(false);
    });

    /** @scenario Default Models list is visible to members whose access comes from role bindings */
    it("lists the project-scoped configs in the Default Models snapshot", async () => {
      const snapshot = await getDefaultModelsSnapshot(memberCtx(), {
        projectId: projectAId,
      });

      const scopedProjectIds = snapshot.configs.flatMap((c) =>
        c.scopes.map((s) => s.id),
      );
      expect(scopedProjectIds).toContain(projectAId);
      expect(scopedProjectIds).toContain(projectBId);
      expect(snapshot.configs.length).toBeGreaterThanOrEqual(2);
    });

    it("offers the team's projects as writable scopes (team MEMBER holds project:update)", async () => {
      const snapshot = await getDefaultModelsSnapshot(memberCtx(), {
        projectId: projectAId,
      });

      const writableProjectIds = snapshot.available.projects.map((p) => p.id);
      expect(writableProjectIds).toContain(projectAId);
      expect(writableProjectIds).toContain(projectBId);
      expect(writableProjectIds).not.toContain(otherTeamProjectId);
    });
  });
});
