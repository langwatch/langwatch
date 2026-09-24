import type { Department, DepartmentAssignments } from "@langwatch/enterprise-governance-contract";

export abstract class DepartmentRepository {
  abstract findAll(organizationId: string): Promise<Department[]>;
  abstract findById(input: { id: string; organizationId: string }): Promise<Department | null>;
  abstract getAssignments(organizationId: string): Promise<DepartmentAssignments>;
  abstract departmentsOnDay(input: {
    organizationId: string;
    userIds: readonly string[];
    dayUtc: string;
  }): Promise<Map<string, string>>;
  abstract create(input: { organizationId: string; name: string }): Promise<Department>;
  abstract resolveByNameOrCreate(input: {
    organizationId: string;
    name: string;
  }): Promise<Department>;
  abstract rename(input: { id: string; organizationId: string; name: string }): Promise<boolean>;
  abstract archive(input: { id: string; organizationId: string }): Promise<boolean>;
  abstract assignUser(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
  }): Promise<boolean>;
  abstract assignTeam(input: {
    organizationId: string;
    teamId: string;
    departmentId: string | null;
  }): Promise<boolean>;
  abstract assignProject(input: {
    organizationId: string;
    projectId: string;
    departmentId: string | null;
  }): Promise<boolean>;
}
