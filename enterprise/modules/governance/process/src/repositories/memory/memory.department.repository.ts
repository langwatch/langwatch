// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Department } from "@langwatch/enterprise-governance-contract";
import { generate } from "@langwatch/ksuid";
import { nowInstant, Temporal, toDate, type Instant } from "@langwatch/time";

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

  async recordMemberDepartment(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
    at: Instant;
  }): Promise<void> {
    const { organizationId, userId, departmentId } = input;
    const links = this.store.departmentMemberships;
    const open = links.find(
      (link) =>
        link.organizationId === organizationId && link.userId === userId && link.validTo === null,
    );
    if (open?.departmentId === departmentId) return;
    if (open) open.validTo = input.at;
    if (departmentId !== null) {
      links.push({
        id: `department_link_${links.length + 1}`,
        organizationId,
        userId,
        departmentId,
        validFrom: input.at,
        validTo: null,
      });
    }
  }

  async findMemberDepartmentsOnDay(input: {
    organizationId: string;
    userIds: readonly string[];
    dayUtc: string;
  }): Promise<{ userId: string; departmentId: string }[]> {
    const endOfDay = Temporal.Instant.from(`${input.dayUtc}T23:59:59.999Z`).epochMilliseconds;
    return this.#links(input)
      .filter(
        (link) =>
          link.validFrom.epochMilliseconds <= endOfDay &&
          (link.validTo === null || link.validTo.epochMilliseconds > endOfDay),
      )
      .map(({ userId, departmentId }) => ({ userId, departmentId }));
  }

  async findOpenMemberDepartmentLinks(input: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<{ userId: string; departmentId: string }[]> {
    return this.#links(input)
      .filter((link) => link.validTo === null)
      .map(({ userId, departmentId }) => ({ userId, departmentId }));
  }

  #links(input: { organizationId: string; userIds: readonly string[] }) {
    const wanted = new Set(input.userIds);
    return this.store.departmentMemberships.filter(
      (link) => link.organizationId === input.organizationId && wanted.has(link.userId),
    );
  }
}
