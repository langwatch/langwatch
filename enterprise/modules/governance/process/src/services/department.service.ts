import {
  DepartmentAssignmentTargetNotFoundError,
  DepartmentNotFoundError,
  type Department,
  type DepartmentAssignments,
} from "@langwatch/enterprise-governance-contract";

import type { OrganizationApi } from "@langwatch/organization-contract";
import { type Instant, nowInstant } from "@langwatch/time";

import type { DepartmentRepository } from "../repositories/department.repository.ts";

/** The member department column is organization's, so it is read and written there. */
export type DepartmentMemberDirectory = Pick<
  OrganizationApi,
  "findMembersWithDepartments" | "assignMemberDepartment"
>;

export class DepartmentService {
  private constructor(
    private readonly repository: DepartmentRepository,
    private readonly members: DepartmentMemberDirectory,
    private readonly now: () => Instant,
  ) {}

  static create(options: {
    repository: DepartmentRepository;
    members: DepartmentMemberDirectory;
    now?: () => Instant;
  }): DepartmentService {
    return new DepartmentService(options.repository, options.members, options.now ?? nowInstant);
  }

  getAll(input: { organizationId: string }): Promise<Department[]> {
    return this.repository.findAll(input.organizationId);
  }

  findById(input: { id: string; organizationId: string }): Promise<Department | null> {
    return this.repository.findById(input);
  }

  /** Main `department.service.ts:106-145`: a member with no display name shows their email. */
  async getAssignments(input: { organizationId: string }): Promise<DepartmentAssignments> {
    const [members, { teams, projects }] = await Promise.all([
      this.members.findMembersWithDepartments(input),
      this.repository.getTeamAndProjectAssignments(input.organizationId),
    ]);
    return {
      users: members
        .map((member) => ({
          id: member.userId,
          name: member.user.name ?? member.user.email ?? member.userId,
          departmentId: member.departmentId,
        }))
        .toSorted((left, right) => left.name.localeCompare(right.name)),
      teams,
      projects,
    };
  }

  departmentsOnDay(input: {
    organizationId: string;
    userIds: readonly string[];
    dayUtc: string;
  }): Promise<Map<string, string>> {
    return this.repository.departmentsOnDay(input);
  }

  create(input: { organizationId: string; name: string }): Promise<Department> {
    return this.repository.create(input);
  }

  resolveByNameOrCreate(input: { organizationId: string; name: string }): Promise<Department> {
    return this.repository.resolveByNameOrCreate(input);
  }

  async rename(input: { id: string; organizationId: string; name: string }): Promise<Department> {
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
    if (!(await this.members.assignMemberDepartment(input))) {
      throw new DepartmentAssignmentTargetNotFoundError("user");
    }
    await this.repository.recordMembership({ ...input, at: this.now() });
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
    if (input.departmentId === null) {
      return;
    }

    await this.getDepartment({
      id: input.departmentId,
      organizationId: input.organizationId,
    });
  }

  private async getDepartment(input: { id: string; organizationId: string }): Promise<Department> {
    const department = await this.repository.findById(input);
    if (!department) {
      throw new DepartmentNotFoundError();
    }

    return department;
  }
}
