import {
  DepartmentAssignmentTargetNotFoundError,
  DepartmentNotFoundError,
  type Department,
  type DepartmentAssignments,
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { DepartmentRepository } from "../../repositories/department.repository.ts";
import { DepartmentService } from "../department.service.ts";

function department(overrides: Partial<Department> = {}): Department {
  return {
    id: "department-1",
    name: "Engineering",
    organizationId: "organization-1",
    createdAt: new Date("2026-08-24T00:00:00.000Z"),
    updatedAt: new Date("2026-08-24T00:00:00.000Z"),
    ...overrides,
  };
}

class MemoryDepartmentRepository extends DepartmentRepository {
  readonly recordMembership = vi.fn(async () => undefined);
  readonly findOpenMemberships = vi.fn(async () => []);
  readonly assignTeam = vi.fn(async () => true);
  readonly assignProject = vi.fn(async () => true);
  renameResult = true;
  archiveResult = true;

  constructor(private readonly row: Department | null = department()) {
    super();
  }

  async findAll(): Promise<Department[]> {
    return this.row ? [this.row] : [];
  }

  async findById(input: { id: string; organizationId: string }): Promise<Department | null> {
    return this.row?.id === input.id && this.row.organizationId === input.organizationId
      ? this.row
      : null;
  }

  async getTeamAndProjectAssignments(): Promise<Pick<DepartmentAssignments, "teams" | "projects">> {
    return { teams: [], projects: [] };
  }

  async departmentsOnDay(): Promise<Map<string, string>> {
    return new Map();
  }

  async create(): Promise<Department> {
    return this.row ?? department();
  }

  async resolveByNameOrCreate(): Promise<Department> {
    return this.row ?? department();
  }

  async rename(): Promise<boolean> {
    return this.renameResult;
  }

  async archive(): Promise<boolean> {
    return this.archiveResult;
  }
}

function members(assigned = true) {
  return createApiFixture<OrganizationApi>({
    findMembersWithDepartments: async () => [],
    assignMemberDepartment: async () => assigned,
  });
}

describe("DepartmentService", () => {
  it("rejects a department owned by another organization before assignment", async () => {
    const repository = new MemoryDepartmentRepository();
    const service = DepartmentService.create({ repository, members: members() });

    await expect(
      service.assignUser({
        organizationId: "organization-2",
        userId: "user-1",
        departmentId: "department-1",
      }),
    ).rejects.toBeInstanceOf(DepartmentNotFoundError);
    expect(repository.recordMembership).not.toHaveBeenCalled();
  });

  it("allows clearing an assignment without looking up a department", async () => {
    const repository = new MemoryDepartmentRepository(null);
    const service = DepartmentService.create({ repository, members: members() });

    await service.assignTeam({
      organizationId: "organization-1",
      teamId: "team-1",
      departmentId: null,
    });

    expect(repository.assignTeam).toHaveBeenCalledOnce();
  });

  it("does not report a missing assignment target as success", async () => {
    const repository = new MemoryDepartmentRepository();
    repository.assignProject.mockResolvedValue(false);
    const service = DepartmentService.create({ repository, members: members() });

    await expect(
      service.assignProject({
        organizationId: "organization-1",
        projectId: "missing-project",
        departmentId: "department-1",
      }),
    ).rejects.toBeInstanceOf(DepartmentAssignmentTargetNotFoundError);
  });

  it("returns the tenant-scoped row after renaming", async () => {
    const repository = new MemoryDepartmentRepository();
    const renamed = await DepartmentService.create({ repository, members: members() }).rename({
      id: "department-1",
      organizationId: "organization-1",
      name: "Platform",
    });

    expect(renamed.id).toBe("department-1");
  });

  it("rejects archiving a department outside the organization", async () => {
    const repository = new MemoryDepartmentRepository();
    repository.archiveResult = false;

    await expect(
      DepartmentService.create({ repository, members: members() }).archive({
        id: "department-1",
        organizationId: "organization-2",
      }),
    ).rejects.toBeInstanceOf(DepartmentNotFoundError);
  });

  describe("when a member is assigned", () => {
    it("points the member through organization and dates the link in governance", async () => {
      const repository = new MemoryDepartmentRepository();
      const at = Temporal.Instant.from("2026-09-03T00:00:00Z");
      const service = DepartmentService.create({ repository, members: members(), now: () => at });

      await service.assignUser({
        organizationId: "organization-1",
        userId: "user-1",
        departmentId: "department-1",
      });

      expect(repository.recordMembership).toHaveBeenCalledWith({
        organizationId: "organization-1",
        userId: "user-1",
        departmentId: "department-1",
        at,
      });
    });

    it("refuses a member organization does not have, and dates nothing", async () => {
      const repository = new MemoryDepartmentRepository();
      const service = DepartmentService.create({ repository, members: members(false) });

      await expect(
        service.assignUser({ organizationId: "organization-1", userId: "ghost", departmentId: null }),
      ).rejects.toBeInstanceOf(DepartmentAssignmentTargetNotFoundError);
      expect(repository.recordMembership).not.toHaveBeenCalled();
    });
  });
});
