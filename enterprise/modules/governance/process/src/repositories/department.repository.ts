import type { Department } from "@langwatch/enterprise-governance-contract";
import type { Instant } from "@langwatch/time";

/** Departments and members' dated links; the current assignment is organization's and project's. */
export abstract class DepartmentRepository {
  abstract findAll(organizationId: string): Promise<Department[]>;
  abstract findById(input: { id: string; organizationId: string }): Promise<Department | null>;
  abstract create(input: { organizationId: string; name: string }): Promise<Department>;
  abstract resolveByNameOrCreate(input: {
    organizationId: string;
    name: string;
  }): Promise<Department>;
  abstract rename(input: { id: string; organizationId: string; name: string }): Promise<boolean>;
  abstract archive(input: { id: string; organizationId: string }): Promise<boolean>;

  /**
   * Closes the open link and opens the new one, in one transaction (main
   * `department.service.ts:229-282`).
   */
  abstract recordMemberDepartment(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
    at: Instant;
  }): Promise<void>;

  abstract findMemberDepartmentsOnDay(input: {
    organizationId: string;
    userIds: readonly string[];
    dayUtc: string;
  }): Promise<{ userId: string; departmentId: string }[]>;

  abstract findOpenMemberDepartmentLinks(input: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<{ userId: string; departmentId: string }[]>;
}
