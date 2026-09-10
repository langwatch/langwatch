// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  Department,
  DepartmentAssignments,
} from "@langwatch/enterprise-governance-contract";
import { generate } from "@langwatch/ksuid";
import { DepartmentPort } from "../directory/department.repository.ts";
import type { MemoryGovernanceStore } from "./memory-governance.store.ts";

const DEPARTMENT_KSUID_RESOURCE = "dept";

/**
 * The department twin. Assignments are held as three maps keyed by the
 * assignable entity, which is the shape the three nullable columns behind the
 * Prisma repository have.
 */
export class MemoryDepartmentRepository extends DepartmentPort {
  private constructor(private readonly store: MemoryGovernanceStore) {
    super();
  }

  static create(store: MemoryGovernanceStore): MemoryDepartmentRepository {
    return new MemoryDepartmentRepository(store);
  }

  async getAll(organizationId: string): Promise<Department[]> {
    return this.store.departments.filter(
      (department) => department.organizationId === organizationId,
    );
  }

  async findById(input: { id: string; organizationId: string }): Promise<Department | null> {
    return (
      this.store.departments.find(
        (department) =>
          department.id === input.id && department.organizationId === input.organizationId,
      ) ?? null
    );
  }

  async getAssignments(organizationId: string): Promise<DepartmentAssignments> {
    const owned = new Set(
      this.store.departments
        .filter((department) => department.organizationId === organizationId)
        .map((department) => department.id),
    );

    const entries = (map: Map<string, string | null>): DepartmentAssignments["users"] =>
      [...map.entries()].map(([id, departmentId]) => ({
        id,
        name: id,
        departmentId: departmentId !== null && owned.has(departmentId) ? departmentId : null,
      }));

    return {
      users: entries(this.store.departmentOfUser),
      teams: entries(this.store.departmentOfTeam),
      projects: entries(this.store.departmentOfProject),
    };
  }

  async create(input: { organizationId: string; name: string }): Promise<Department> {
    const now = new Date();
    const department: Department = {
      id: generate(DEPARTMENT_KSUID_RESOURCE).toString(),
      name: input.name,
      organizationId: input.organizationId,
      createdAt: now,
      updatedAt: now,
    };
    this.store.departments.push(department);
    return department;
  }

  async resolveByNameOrCreate(input: {
    organizationId: string;
    name: string;
  }): Promise<Department> {
    const existing = this.store.departments.find(
      (department) =>
        department.organizationId === input.organizationId && department.name === input.name,
    );
    return existing ?? (await this.create(input));
  }

  async rename(input: { id: string; organizationId: string; name: string }): Promise<boolean> {
    const department = await this.findById(input);
    if (!department) return false;
    department.name = input.name;
    department.updatedAt = new Date();
    return true;
  }

  async archive(input: { id: string; organizationId: string }): Promise<boolean> {
    const index = this.store.departments.findIndex(
      (department) =>
        department.id === input.id && department.organizationId === input.organizationId,
    );
    if (index < 0) return false;
    this.store.departments.splice(index, 1);
    return true;
  }

  async assignUser(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
  }): Promise<boolean> {
    return this.assign(this.store.departmentOfUser, input.userId, input);
  }

  async assignTeam(input: {
    organizationId: string;
    teamId: string;
    departmentId: string | null;
  }): Promise<boolean> {
    return this.assign(this.store.departmentOfTeam, input.teamId, input);
  }

  async assignProject(input: {
    organizationId: string;
    projectId: string;
    departmentId: string | null;
  }): Promise<boolean> {
    return this.assign(this.store.departmentOfProject, input.projectId, input);
  }

  private async assign(
    map: Map<string, string | null>,
    entityId: string,
    input: { organizationId: string; departmentId: string | null },
  ): Promise<boolean> {
    if (input.departmentId !== null) {
      const department = await this.findById({
        id: input.departmentId,
        organizationId: input.organizationId,
      });
      if (!department) return false;
    }
    map.set(entityId, input.departmentId);
    return true;
  }
}
