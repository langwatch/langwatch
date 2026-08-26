// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  Department,
  DepartmentAssignments,
} from "@langwatch/enterprise-governance-contract";
import type { DepartmentService } from "./department.service";

/** Keeps the department capability behind the public Governance boundary. */
export class GovernanceDepartmentService {
  private constructor(private readonly service: DepartmentService) {}

  static create(service: DepartmentService): GovernanceDepartmentService {
    return new GovernanceDepartmentService(service);
  }

  list(organizationId: string): Promise<Department[]> {
    return this.service.getAll({ organizationId });
  }

  assignments(organizationId: string): Promise<DepartmentAssignments> {
    return this.service.getAssignments({ organizationId });
  }

  create(input: { organizationId: string; name: string }): Promise<Department> {
    return this.service.create(input);
  }

  resolveByNameOrCreate(input: {
    organizationId: string;
    name: string;
  }): Promise<Department> {
    return this.service.resolveByNameOrCreate(input);
  }

  rename(input: {
    id: string;
    organizationId: string;
    name: string;
  }): Promise<Department> {
    return this.service.rename(input);
  }

  archive(input: { id: string; organizationId: string }): Promise<void> {
    return this.service.archive(input);
  }

  assignUser(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
  }): Promise<void> {
    return this.service.assignUser(input);
  }

  assignTeam(input: {
    organizationId: string;
    teamId: string;
    departmentId: string | null;
  }): Promise<void> {
    return this.service.assignTeam(input);
  }

  assignProject(input: {
    organizationId: string;
    projectId: string;
    departmentId: string | null;
  }): Promise<void> {
    return this.service.assignProject(input);
  }
}
