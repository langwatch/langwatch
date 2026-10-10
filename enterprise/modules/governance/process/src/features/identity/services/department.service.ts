import {
  DepartmentAssignmentTargetNotFoundError,
  DepartmentNotFoundError,
  type Department,
  type DepartmentAssignments,
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { projectKindsHiddenFrom, type ProjectApi } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";

import type { DepartmentRepository } from "../../../repositories/department.repository.ts";

/** Members and teams sit in organization's tables; the dated links are this module's own. */
export type DepartmentOrganizations = Pick<
  OrganizationApi,
  | "findMembersWithDepartments"
  | "assignMemberDepartment"
  | "findTeamsWithDepartments"
  | "assignTeamDepartment"
>;

export type DepartmentProjects = Pick<
  ProjectApi,
  "findProjectsWithDepartments" | "assignProjectDepartment"
>;

/** This module's own department write, fed to the aggregate reconcile (M8487-DEPT-CHANGE). */
export type MemberDepartmentAssigned = (fact: {
  organizationId: string;
  userId: string;
  occurredAt: number;
}) => Promise<void>;

export class DepartmentService {
  private constructor(
    private readonly repository: DepartmentRepository,
    private readonly peers: {
      organizations: DepartmentOrganizations;
      projects: DepartmentProjects;
      onMemberDepartmentAssigned?: MemberDepartmentAssigned;
    },
  ) {}

  static create(options: {
    repository: DepartmentRepository;
    organizations: DepartmentOrganizations;
    projects: DepartmentProjects;
    onMemberDepartmentAssigned?: MemberDepartmentAssigned;
  }): DepartmentService {
    return new DepartmentService(options.repository, options);
  }

  getAll(input: { organizationId: string }): Promise<Department[]> {
    return this.repository.findAll(input.organizationId);
  }

  findById(input: { id: string; organizationId: string }): Promise<Department | null> {
    return this.repository.findById(input);
  }

  /**
   * Main `department.service.ts:106-145`: a member with no display name shows their email; an
   * aggregate project is listed to an organisation admin only (ADR-177 decision 5).
   */
  async getAssignments(input: {
    organizationId: string;
    callerOrganizationRole: string | null;
  }): Promise<DepartmentAssignments> {
    const { organizationId } = input;
    const [members, teams, projects] = await Promise.all([
      this.peers.organizations.findMembersWithDepartments({ organizationId }),
      this.peers.organizations.findTeamsWithDepartments({ organizationId }),
      this.peers.projects.findProjectsWithDepartments({
        organizationId,
        hiddenKinds: projectKindsHiddenFrom(input.callerOrganizationRole),
      }),
    ]);
    return {
      users: members
        .map((member) => ({
          id: member.userId,
          name: member.user.name ?? member.user.email ?? member.userId,
          email: member.user.email,
          departmentId: member.departmentId,
        }))
        .toSorted((left, right) => left.name.localeCompare(right.name)),
      teams,
      projects,
    };
  }

  /** Main `department.service.ts:283-317`: absent from the map means unassigned that day. */
  async departmentsOnDay(input: {
    organizationId: string;
    userIds: readonly string[];
    dayUtc: string;
  }): Promise<Map<string, string>> {
    const links = await this.repository.findMemberDepartmentsOnDay(input);
    return new Map(links.map((link) => [link.userId, link.departmentId]));
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
    if (!(await this.peers.organizations.assignMemberDepartment(input))) {
      throw new DepartmentAssignmentTargetNotFoundError("user");
    }
    const at = nowInstant();
    await this.repository.recordMemberDepartment({ ...input, at });
    await this.peers.onMemberDepartmentAssigned?.({
      organizationId: input.organizationId,
      userId: input.userId,
      occurredAt: at.epochMilliseconds,
    });
  }

  findOpenUserLinks(input: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<{ userId: string; departmentId: string }[]> {
    return this.repository.findOpenMemberDepartmentLinks(input);
  }

  async assignTeam(input: {
    organizationId: string;
    teamId: string;
    departmentId: string | null;
  }): Promise<void> {
    await this.assertDepartmentInOrganization(input);
    if (!(await this.peers.organizations.assignTeamDepartment(input))) {
      throw new DepartmentAssignmentTargetNotFoundError("team");
    }
  }

  async assignProject(input: {
    organizationId: string;
    projectId: string;
    departmentId: string | null;
  }): Promise<void> {
    await this.assertDepartmentInOrganization(input);
    if (!(await this.peers.projects.assignProjectDepartment(input))) {
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
