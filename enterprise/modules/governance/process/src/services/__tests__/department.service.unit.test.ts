import { createApiFixture } from "@langwatch/api-fixture";
import {
  DepartmentAssignmentTargetNotFoundError,
  DepartmentNotFoundError,
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { MemoryDepartmentRepository } from "../../repositories/memory/memory.department.repository.ts";
import { MemoryGovernanceStore } from "../../repositories/memory/memory.governance.store.ts";
import { DepartmentService } from "../department.service.ts";

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
      { userId: "user-2", departmentId: null, user: { name: null, email: "zed@acme.com" } },
      {
        userId: "user-1",
        departmentId: department.id,
        user: { name: "Ada", email: "ada@acme.com" },
      },
    ],
    findTeamsWithDepartments: async () => [{ id: "team-1", name: "Web", departmentId: null }],
    findMemberDepartmentsOnDay: async () => [{ userId: "user-1", departmentId: department.id }],
  });
  const projects = createApiFixture<ProjectApi>({
    assignProjectDepartment: async ({ projectId }) => (writes.push(`project:${projectId}`), exists),
    findProjectsWithDepartments: async () => [
      { id: "project-1", name: "Chat", departmentId: department.id },
    ],
  });
  const service = DepartmentService.create({ repository, organizations, projects });
  return { service, department, writes };
}

describe("DepartmentService", () => {
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

    expect(await service.getAssignments({ organizationId: ORG })).toEqual({
      users: [
        { id: "user-1", name: "Ada", email: "ada@acme.com", departmentId: department.id },
        { id: "user-2", name: "zed@acme.com", email: "zed@acme.com", departmentId: null },
      ],
      teams: [{ id: "team-1", name: "Web", departmentId: null }],
      projects: [{ id: "project-1", name: "Chat", departmentId: department.id }],
    });
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
