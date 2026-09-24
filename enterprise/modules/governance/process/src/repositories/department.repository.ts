import type { Department, DepartmentAssignments } from "@langwatch/enterprise-governance-contract";
import type { Instant } from "@langwatch/time";

export abstract class DepartmentRepository {
  abstract findAll(organizationId: string): Promise<Department[]>;
  abstract findById(input: { id: string; organizationId: string }): Promise<Department | null>;
  abstract getTeamAndProjectAssignments(
    organizationId: string,
  ): Promise<Pick<DepartmentAssignments, "teams" | "projects">>;
  abstract departmentsOnDay(input: {
    organizationId: string;
    userIds: readonly string[];
    dayUtc: string;
  }): Promise<Map<string, string>>;
  /** Each named member's open membership-history row (`validTo` null). */
  abstract findOpenMemberships(input: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<{ userId: string; departmentId: string }[]>;
  abstract create(input: { organizationId: string; name: string }): Promise<Department>;
  abstract resolveByNameOrCreate(input: {
    organizationId: string;
    name: string;
  }): Promise<Department>;
  abstract rename(input: { id: string; organizationId: string; name: string }): Promise<boolean>;
  abstract archive(input: { id: string; organizationId: string }): Promise<boolean>;
  /** Main `department.service.ts:246-275`: close the open dated link and open the new one; a no-op when unchanged. */
  abstract recordMembership(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
    at: Instant;
  }): Promise<void>;
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
