/**
 * @vitest-environment node
 *
 * Integration tests for DataPrivacyPolicyRepository against the real
 * database: scope-facts resolution (including the personal-project owner
 * department), the chain query, the per-scope upsert/delete roundtrip, and
 * the cache-invalidation reach of every scope tier.
 */
import type { Department, Project, Team, User } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTestProject } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { DataPrivacyPolicyRepository } from "../dataPrivacyPolicy.repository";

const NAMESPACE = "dataprivacy-repo";
const OWNER_EMAIL = `${NAMESPACE}-owner@example.com`;

describe("DataPrivacyPolicyRepository integration", () => {
  const repository = new DataPrivacyPolicyRepository(prisma);

  let organizationId: string;
  let teamId: string;
  let project: Project;
  let department: Department;
  let owner: User;
  let personalTeam: Team;
  let personalProject: Project;

  beforeAll(async () => {
    project = await getTestProject(NAMESPACE);
    teamId = project.teamId;
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });
    organizationId = team!.organizationId;

    department = await prisma.department.create({
      data: { organizationId, name: `Privacy Repo Dept ${nanoid(6)}` },
    });

    // Regular project carries its own department assignment.
    project = await prisma.project.update({
      where: { id: project.id },
      data: { departmentId: department.id },
    });

    // Personal project: department comes from the OWNER's membership row.
    owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { name: "Privacy Repo Owner", email: OWNER_EMAIL },
    });
    await prisma.organizationUser.upsert({
      where: {
        userId_organizationId: { userId: owner.id, organizationId },
      },
      update: { departmentId: department.id },
      create: {
        userId: owner.id,
        organizationId,
        role: "MEMBER",
        departmentId: department.id,
      },
    });
    personalTeam = await prisma.team.create({
      data: {
        name: "Privacy Repo Personal Team",
        slug: `--test-${NAMESPACE}-personal-team-${nanoid(8)}`,
        organizationId,
        isPersonal: true,
        ownerUserId: owner.id,
      },
    });
    personalProject = await prisma.project.create({
      data: {
        name: "Privacy Repo Personal Project",
        slug: `--test-${NAMESPACE}-personal-project-${nanoid(8)}`,
        apiKey: `test-auth-token-${nanoid()}`,
        teamId: personalTeam.id,
        language: "python",
        framework: "openai",
        isPersonal: true,
        ownerUserId: owner.id,
      },
    });
  });

  afterAll(async () => {
    await prisma.dataPrivacyPolicy.deleteMany({ where: { organizationId } });
    await prisma.project.delete({ where: { id: personalProject.id } });
    await prisma.team.delete({
      where: { id: personalTeam.id, organizationId },
    });
    await prisma.organizationUser.delete({
      where: {
        userId_organizationId: { userId: owner.id, organizationId },
      },
    });
    await prisma.department.delete({ where: { id: department.id } });
  });

  describe("given a regular project assigned to a department", () => {
    describe("when its scope facts are resolved", () => {
      it("uses the project's own department", async () => {
        const facts = await repository.getProjectScopeFacts({
          projectId: project.id,
        });

        expect(facts).toEqual({
          organizationId,
          teamId,
          projectId: project.id,
          departmentId: department.id,
          isPersonal: false,
        });
      });
    });
  });

  describe("given a personal project whose owner sits in a department", () => {
    describe("when its scope facts are resolved", () => {
      it("uses the owner's department", async () => {
        const facts = await repository.getProjectScopeFacts({
          projectId: personalProject.id,
        });

        expect(facts).toEqual({
          organizationId,
          teamId: personalTeam.id,
          projectId: personalProject.id,
          departmentId: department.id,
          isPersonal: true,
        });
      });
    });
  });

  describe("given a project id that does not exist", () => {
    describe("when its scope facts are resolved", () => {
      it("returns null", async () => {
        const facts = await repository.getProjectScopeFacts({
          projectId: `missing-${nanoid()}`,
        });

        expect(facts).toBeNull();
      });
    });
  });

  describe("given rules upserted at several tiers of the project's chain", () => {
    describe("when the chain is fetched, a rule is updated, and a rule is deleted", () => {
      it("roundtrips upsert, chain read, update-in-place, and delete", async () => {
        await prisma.dataPrivacyPolicy.deleteMany({
          where: { organizationId },
        });

        await repository.upsertForScope({
          organizationId,
          scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
          personalOnly: false,
          config: { pii: { level: "strict" } },
        });
        await repository.upsertForScope({
          organizationId,
          scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
          personalOnly: true,
          config: { categories: { output: { disposition: "drop" } } },
        });
        await repository.upsertForScope({
          organizationId,
          scope: { scopeType: "PROJECT", scopeId: project.id },
          personalOnly: false,
          config: { categories: { input: { disposition: "drop" } } },
        });

        const facts = (await repository.getProjectScopeFacts({
          projectId: project.id,
        }))!;
        const rows = await repository.findForProjectChain(facts);

        // Both personalOnly variants of the org rule come back; the resolver
        // is the one that picks which candidates apply to this project.
        expect(rows).toHaveLength(3);
        expect(rows).toEqual(
          expect.arrayContaining([
            {
              scopeType: "ORGANIZATION",
              scopeId: organizationId,
              personalOnly: false,
              config: { pii: { level: "strict" } },
            },
            {
              scopeType: "ORGANIZATION",
              scopeId: organizationId,
              personalOnly: true,
              config: { categories: { output: { disposition: "drop" } } },
            },
            {
              scopeType: "PROJECT",
              scopeId: project.id,
              personalOnly: false,
              config: { categories: { input: { disposition: "drop" } } },
            },
          ]),
        );

        // Re-upserting the same (scope, personalOnly) updates in place.
        await repository.upsertForScope({
          organizationId,
          scope: { scopeType: "PROJECT", scopeId: project.id },
          personalOnly: false,
          config: { categories: { input: { disposition: "restrict" } } },
        });
        const allRows = await repository.findAllInOrganization({
          organizationId,
        });
        const projectRows = allRows.filter(
          (r) => r.scopeType === "PROJECT" && r.scopeId === project.id,
        );
        expect(projectRows).toHaveLength(1);
        expect(projectRows[0]!.config).toEqual({
          categories: { input: { disposition: "restrict" } },
        });

        await repository.deleteForScope({
          scope: { scopeType: "PROJECT", scopeId: project.id },
          personalOnly: false,
        });
        const rowsAfterDelete = await repository.findForProjectChain(facts);
        expect(rowsAfterDelete).toHaveLength(2);
        expect(rowsAfterDelete.some((r) => r.scopeType === "PROJECT")).toBe(
          false,
        );

        await prisma.dataPrivacyPolicy.deleteMany({
          where: { organizationId },
        });
      });
    });

    describe("when a stored rule's config no longer parses", () => {
      it("skips the invalid row and returns the valid ones", async () => {
        await prisma.dataPrivacyPolicy.deleteMany({
          where: { organizationId },
        });

        await prisma.dataPrivacyPolicy.create({
          data: {
            organizationId,
            scopeType: "TEAM",
            scopeId: teamId,
            personalOnly: false,
            config: { categories: { input: { disposition: "explode" } } },
          },
        });
        await repository.upsertForScope({
          organizationId,
          scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
          personalOnly: false,
          config: { pii: { level: "disabled" } },
        });

        const facts = (await repository.getProjectScopeFacts({
          projectId: project.id,
        }))!;
        const rows = await repository.findForProjectChain(facts);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          scopeType: "ORGANIZATION",
          config: { pii: { level: "disabled" } },
        });

        await prisma.dataPrivacyPolicy.deleteMany({
          where: { organizationId },
        });
      });
    });
  });

  describe("given the four scope tiers", () => {
    describe("when the owning organization is resolved", () => {
      it("resolves a DEPARTMENT scope through the department table", async () => {
        const resolved = await repository.findOrganizationForScope({
          scopeType: "DEPARTMENT",
          scopeId: department.id,
        });
        expect(resolved).toBe(organizationId);
      });

      it("resolves a TEAM scope through the team table", async () => {
        const resolved = await repository.findOrganizationForScope({
          scopeType: "TEAM",
          scopeId: teamId,
        });
        expect(resolved).toBe(organizationId);
      });

      it("resolves a PROJECT scope through the project's team", async () => {
        const resolved = await repository.findOrganizationForScope({
          scopeType: "PROJECT",
          scopeId: project.id,
        });
        expect(resolved).toBe(organizationId);
      });

      it("returns null for a department that does not exist", async () => {
        const resolved = await repository.findOrganizationForScope({
          scopeType: "DEPARTMENT",
          scopeId: `missing-${nanoid()}`,
        });
        expect(resolved).toBeNull();
      });
    });
  });

  describe("given regular and personal projects reached by each scope tier", () => {
    describe("when affected project ids are computed for an ORGANIZATION scope", () => {
      it("reaches every project in the organization", async () => {
        const ids = await repository.findAffectedProjectIds({
          scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
          personalOnly: false,
        });
        expect(ids).toContain(project.id);
        expect(ids).toContain(personalProject.id);
      });

      it("narrows to personal projects when personalOnly is set", async () => {
        const ids = await repository.findAffectedProjectIds({
          scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
          personalOnly: true,
        });
        expect(ids).toContain(personalProject.id);
        expect(ids).not.toContain(project.id);
      });
    });

    describe("when affected project ids are computed for a TEAM scope", () => {
      it("reaches the team's projects only", async () => {
        const ids = await repository.findAffectedProjectIds({
          scope: { scopeType: "TEAM", scopeId: teamId },
          personalOnly: false,
        });
        expect(ids).toContain(project.id);
        expect(ids).not.toContain(personalProject.id);
      });
    });

    describe("when affected project ids are computed for a PROJECT scope", () => {
      it("reaches exactly that project", async () => {
        const ids = await repository.findAffectedProjectIds({
          scope: { scopeType: "PROJECT", scopeId: project.id },
          personalOnly: false,
        });
        expect(ids).toEqual([project.id]);
      });
    });

    describe("when affected project ids are computed for a DEPARTMENT scope", () => {
      it("reaches department-assigned projects plus personal projects of department members", async () => {
        const ids = await repository.findAffectedProjectIds({
          scope: { scopeType: "DEPARTMENT", scopeId: department.id },
          personalOnly: false,
        });
        expect(ids).toContain(project.id);
        expect(ids).toContain(personalProject.id);
      });

      it("narrows to the personal-project side when personalOnly is set", async () => {
        const ids = await repository.findAffectedProjectIds({
          scope: { scopeType: "DEPARTMENT", scopeId: department.id },
          personalOnly: true,
        });
        expect(ids).toContain(personalProject.id);
        expect(ids).not.toContain(project.id);
      });

      it("reaches nothing for a department that does not exist", async () => {
        const ids = await repository.findAffectedProjectIds({
          scope: { scopeType: "DEPARTMENT", scopeId: `missing-${nanoid()}` },
          personalOnly: false,
        });
        expect(ids).toEqual([]);
      });
    });
  });
});
