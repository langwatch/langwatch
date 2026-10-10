import {
  DepartmentAssignmentTargetNotFoundError,
  DepartmentNotFoundError,
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { DepartmentService } from "../../features/identity/services/department.service.ts";
import { MemoryDepartmentRepository } from "../../repositories/memory/memory.department.repository.ts";
import { MemoryGovernanceStore } from "../../repositories/memory/memory.governance.store.ts";

const ORG = "organization-1";

async function harness(options: { targetExists?: boolean } = {}) {
  const repository = MemoryDepartmentRepository.create(MemoryGovernanceStore.create());
  const department = await repository.create({ organizationId: ORG, name: "Engineering" });
  const writes: string[] = [];
  const exists = options.targetExists ?? true;
  const organizations = createApiFixture<OrganizationApi>({
    assignMemberDepartment: async ({ userId }) => (writes.push(`user:${userId}`), exists),
    assignTeamDepartment: async ({ teamId }) => (writes.push(`team:${teamId}`), exists),
    findMembersWithDepartments: async () => [
      {
        userId: "user-2",
        departmentId: null,
        disabledAt: null,
        user: { name: null, email: "zed@acme.com" },
      },
      {
        userId: "user-1",
        departmentId: department.id,
        disabledAt: null,
        user: { name: "Ada", email: "ada@acme.com" },
      },
    ],
    findTeamsWithDepartments: async () => [{ id: "team-1", name: "Web", departmentId: null }],
  });
  await repository.recordMemberDepartment({
    organizationId: ORG,
    userId: "user-1",
    departmentId: department.id,
    at: Temporal.Instant.from("2026-01-01T00:00:00Z"),
  });
  const hiddenAsked: string[][] = [];
  const projects = createApiFixture<ProjectApi>({
    assignProjectDepartment: async ({ projectId }) => (writes.push(`project:${projectId}`), exists),
    findProjectsWithDepartments: async ({ hiddenKinds }) => {
      hiddenAsked.push([...hiddenKinds]);
      return [{ id: "project-1", name: "Chat", departmentId: department.id }];
    },
  });
  const reconciles: string[] = [];
  const service = DepartmentService.create({
    repository,
    organizations,
    projects,
    onMemberDepartmentAssigned: async ({ userId }) => {
      reconciles.push(userId);
    },
  });
  return { service, department, writes, repository, reconciles, hiddenAsked };
}

describe("DepartmentService", () => {
  /** @scenario "Department assignments are organization scoped" */
  it("rejects a department owned by another organization before assignment", async () => {
    const { service, department, writes } = await harness();

    await expect(
      service.assignUser({
        organizationId: "organization-2",
        userId: "user-1",
        departmentId: department.id,
      }),
    ).rejects.toBeInstanceOf(DepartmentNotFoundError);
    expect(writes).toEqual([]);
  });

  it("allows clearing an assignment without looking up a department", async () => {
    const { service, writes } = await harness();

    await service.assignTeam({ organizationId: ORG, teamId: "team-1", departmentId: null });

    expect(writes).toEqual(["team:team-1"]);
  });

  /** @scenario "Department assignments are organization scoped" */
  it("does not report a missing assignment target as success", async () => {
    const { service, department } = await harness({ targetExists: false });

    await expect(
      service.assignProject({
        organizationId: ORG,
        projectId: "missing",
        departmentId: department.id,
      }),
    ).rejects.toBeInstanceOf(DepartmentAssignmentTargetNotFoundError);
    await expect(
      service.assignUser({ organizationId: ORG, userId: "ghost", departmentId: null }),
    ).rejects.toBeInstanceOf(DepartmentAssignmentTargetNotFoundError);
  });

  it("dates the member's link once organization has moved the column, once per resend", async () => {
    const { service, department, repository } = await harness();
    const assign = () =>
      service.assignUser({ organizationId: ORG, userId: "user-3", departmentId: department.id });

    await assign();
    await assign();

    expect(
      await repository.findOpenMemberDepartmentLinks({ organizationId: ORG, userIds: ["user-3"] }),
    ).toEqual([{ userId: "user-3", departmentId: department.id }]);
  });

  it("dates no link for someone organization has no member row for", async () => {
    const { service, department, repository } = await harness({ targetExists: false });

    await expect(
      service.assignUser({ organizationId: ORG, userId: "ghost", departmentId: department.id }),
    ).rejects.toBeInstanceOf(DepartmentAssignmentTargetNotFoundError);
    expect(
      await repository.findOpenMemberDepartmentLinks({ organizationId: ORG, userIds: ["ghost"] }),
    ).toEqual([]);
  });

  it("returns the tenant-scoped row after renaming", async () => {
    const { service, department } = await harness();

    const renamed = await service.rename({
      id: department.id,
      organizationId: ORG,
      name: "Platform",
    });

    expect(renamed).toMatchObject({ id: department.id, name: "Platform" });
  });

  it("rejects archiving a department outside the organization", async () => {
    const { service, department } = await harness();

    await expect(
      service.archive({ id: department.id, organizationId: "organization-2" }),
    ).rejects.toBeInstanceOf(DepartmentNotFoundError);
  });

  it("lists members with their email, named by display name or else email, beside teams and projects", async () => {
    const { service, department } = await harness();

    expect(
      await service.getAssignments({ organizationId: ORG, callerOrganizationRole: "ADMIN" }),
    ).toEqual({
      users: [
        { id: "user-1", name: "Ada", email: "ada@acme.com", departmentId: department.id },
        { id: "user-2", name: "zed@acme.com", email: "zed@acme.com", departmentId: null },
      ],
      teams: [{ id: "team-1", name: "Web", departmentId: null }],
      projects: [{ id: "project-1", name: "Chat", departmentId: department.id }],
    });
  });

  /** ADR-177 decision 5: only an organisation admin sees an aggregate project. */
  it.each([
    ["ADMIN", [PROJECT_KIND.INTERNAL_GOVERNANCE]],
    ["MEMBER", [PROJECT_KIND.INTERNAL_GOVERNANCE, PROJECT_KIND.AGGREGATE]],
    [null, [PROJECT_KIND.INTERNAL_GOVERNANCE, PROJECT_KIND.AGGREGATE]],
  ])("asks for the projects a %s caller may see", async (role, hidden) => {
    const { service, hiddenAsked } = await harness();

    await service.getAssignments({ organizationId: ORG, callerOrganizationRole: role });

    expect(hiddenAsked).toEqual([hidden]);
  });

  it("answers a past day's departments keyed by member", async () => {
    const { service, department } = await harness();

    const onDay = await service.departmentsOnDay({
      organizationId: ORG,
      userIds: ["user-1"],
      dayUtc: "2026-01-20",
    });

    expect([...onDay]).toEqual([["user-1", department.id]]);
  });
});

describe("given a member's department assigned from governance", () => {
  describe("when the member exists", () => {
    it("enqueues the aggregate reconcile once the write lands", async () => {
      const { service, department, reconciles } = await harness();

      await service.assignUser({
        organizationId: ORG,
        userId: "user-2",
        departmentId: department.id,
      });

      expect(reconciles).toEqual(["user-2"]);
    });
  });

  describe("when the member is not found", () => {
    it("enqueues nothing, because nothing changed", async () => {
      const { service, department, reconciles } = await harness({ targetExists: false });

      await expect(
        service.assignUser({ organizationId: ORG, userId: "user-9", departmentId: department.id }),
      ).rejects.toBeInstanceOf(DepartmentAssignmentTargetNotFoundError);
      expect(reconciles).toEqual([]);
    });
  });
});
