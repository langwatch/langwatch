import {
  DepartmentAssignmentTargetNotFoundError,
  DepartmentNotFoundError,
  type Department,
  type DepartmentAssignments,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it, vi } from "vitest";
import { DepartmentRepository } from "../department.port";
import { DepartmentService } from "../../services/department.service";

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
  readonly assignUser = vi.fn(async () => true);
  readonly assignTeam = vi.fn(async () => true);
  readonly assignProject = vi.fn(async () => true);
  renameResult = true;
  archiveResult = true;

  constructor(private readonly row: Department | null = department()) {
    super();
  }

  async getAll(): Promise<Department[]> {
    return this.row ? [this.row] : [];
  }

  async tryGetById(input: { id: string; organizationId: string }): Promise<Department | null> {
    return this.row?.id === input.id && this.row.organizationId === input.organizationId
      ? this.row
      : null;
  }

  async getAssignments(): Promise<DepartmentAssignments> {
    return { users: [], teams: [], projects: [] };
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

describe("DepartmentService", () => {
  it("rejects a department owned by another organization before assignment", async () => {
    const repository = new MemoryDepartmentRepository();
    const service = DepartmentService.create({ repository });

    await expect(
      service.assignUser({
        organizationId: "organization-2",
        userId: "user-1",
        departmentId: "department-1",
      }),
    ).rejects.toBeInstanceOf(DepartmentNotFoundError);
    expect(repository.assignUser).not.toHaveBeenCalled();
  });

  it("allows clearing an assignment without looking up a department", async () => {
    const repository = new MemoryDepartmentRepository(null);
    const service = DepartmentService.create({ repository });

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
    const service = DepartmentService.create({ repository });

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
    const renamed = await DepartmentService.create({ repository }).rename({
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
      DepartmentService.create({ repository }).archive({
        id: "department-1",
        organizationId: "organization-2",
      }),
    ).rejects.toBeInstanceOf(DepartmentNotFoundError);
  });
});
