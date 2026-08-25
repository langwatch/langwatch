import {
  DepartmentAssignmentTargetNotFoundError,
  DepartmentNotFoundError,
  type Department,
  type DepartmentAssignments,
} from "@langwatch/enterprise-governance-contract";
import type { DepartmentRepository } from "../ports/department.port";

export class DepartmentService {
  private constructor(private readonly repository: DepartmentRepository) {}

  static create(options: { repository: DepartmentRepository }): DepartmentService {
    return new DepartmentService(options.repository);
  }

  getAll(input: { organizationId: string }): Promise<Department[]> {
    return this.repository.getAll(input.organizationId);
  }

  tryGetById(input: { id: string; organizationId: string }): Promise<Department | null> {
    return this.repository.tryGetById(input);
  }

  getAssignments(input: { organizationId: string }): Promise<DepartmentAssignments> {
    return this.repository.getAssignments(input.organizationId);
  }

  create(input: { organizationId: string; name: string }): Promise<Department> {
    return this.repository.create(input);
  }

  resolveByNameOrCreate(input: {
    organizationId: string;
    name: string;
  }): Promise<Department> {
    return this.repository.resolveByNameOrCreate(input);
  }

  async rename(input: {
    id: string;
    organizationId: string;
    name: string;
  }): Promise<Department> {
    if (!(await this.repository.rename(input))) {
      throw new DepartmentNotFoundError();
    }
    return this.getDepartment(input);
  }

  async archive(input: { id: string; organizationId: string }): Promise<void> {
    if (!(await this.repository.archive(input))) {
      throw new DepartmentNotFoundError();
    }
  }

  async assignUser(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
  }): Promise<void> {
    await this.assertDepartmentInOrganization(input);
    if (!(await this.repository.assignUser(input))) {
      throw new DepartmentAssignmentTargetNotFoundError("user");
    }
  }

  async assignTeam(input: {
    organizationId: string;
    teamId: string;
    departmentId: string | null;
  }): Promise<void> {
    await this.assertDepartmentInOrganization(input);
    if (!(await this.repository.assignTeam(input))) {
      throw new DepartmentAssignmentTargetNotFoundError("team");
    }
  }

  async assignProject(input: {
    organizationId: string;
    projectId: string;
    departmentId: string | null;
  }): Promise<void> {
    await this.assertDepartmentInOrganization(input);
    if (!(await this.repository.assignProject(input))) {
      throw new DepartmentAssignmentTargetNotFoundError("project");
    }
  }

  private async assertDepartmentInOrganization(input: {
    organizationId: string;
    departmentId: string | null;
  }): Promise<void> {
    if (input.departmentId === null) return;
    await this.getDepartment({
      id: input.departmentId,
      organizationId: input.organizationId,
    });
  }

  private async getDepartment(input: {
    id: string;
    organizationId: string;
  }): Promise<Department> {
    const department = await this.repository.tryGetById(input);
    if (!department) throw new DepartmentNotFoundError();
    return department;
  }
}
