// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Department } from "@langwatch/enterprise-governance-contract";
import { generate } from "@langwatch/ksuid";
import { nowInstant, toDate } from "@langwatch/time";

import { DepartmentRepository } from "../department.repository.ts";
import type { MemoryGovernanceStore } from "./memory.governance.store.ts";

const DEPARTMENT_KSUID_RESOURCE = "dept";

/** The department twin. */
export class MemoryDepartmentRepository extends DepartmentRepository {
  private constructor(private readonly store: MemoryGovernanceStore) {
    super();
  }

  static create(store: MemoryGovernanceStore): MemoryDepartmentRepository {
    return new MemoryDepartmentRepository(store);
  }

  async findAll(organizationId: string): Promise<Department[]> {
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

  async create(input: { organizationId: string; name: string }): Promise<Department> {
    const now = toDate(nowInstant());
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
    department.updatedAt = toDate(nowInstant());
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
}
