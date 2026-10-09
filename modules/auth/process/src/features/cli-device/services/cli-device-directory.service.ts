import { HandledError } from "@langwatch/handled-error";
import { OrganizationNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
import { type Project, ProjectNotFoundError } from "@langwatch/project-contract";

import type { AuthDirectoryRepository } from "../../../repositories/auth-directory.repository.ts";

/** The project fields a device grant binds a session to. */
export type AuthDirectoryProject = Pick<
  Project,
  "id" | "slug" | "name" | "teamId" | "isPersonal" | "ownerUserId"
>;

/**
 * The person, organization, membership and project reads the device grant runs on. Membership
 * is re-derived on every call, not trusted from the record: an admin can disable a seat between
 * approve and exchange.
 */
export interface CliDeviceDirectory {
  /** Throws `OrganizationNotFoundError` when no organization claims the domain. */
  getOrganizationIdBySsoDomain(domain: string): Promise<string>;
  /** Throws `UserNotFoundError`. */
  getPerson(userId: string): Promise<{ id: string; email: string | null; name: string | null }>;
  /** Throws `OrganizationNotFoundError`. */
  getOrganization(organizationId: string): Promise<{ id: string; name: string; slug: string }>;
  /** Zero, or an unknown organization, is unbounded. */
  maxSessionDurationDays(organizationId: string): Promise<number>;
  hasActiveMembership(params: { userId: string; organizationId: string }): Promise<boolean>;
  /** The seat an enabled member holds here; null for a stranger or a disabled seat. */
  findActiveMemberRole(params: { userId: string; organizationId: string }): Promise<string | null>;
  /** An unarchived project of the organization; throws `ProjectNotFoundError`. */
  getLiveProject(params: {
    projectId: string;
    organizationId: string;
  }): Promise<AuthDirectoryProject>;
  /** An unarchived project of the organization by id, else slug; throws `ProjectNotFoundError`. */
  getLiveProjectByRef(params: {
    projectRef: string;
    organizationId: string;
  }): Promise<AuthDirectoryProject>;
}

interface CliDeviceDirectoryServiceDeps {
  people: AuthDirectoryRepository;
  organizations: Pick<
    OrganizationApi,
    "findBySsoDomain" | "findProvisioningSummary" | "getSessionPolicy" | "isMember" | "getMember"
  >;
  projects: CliDeviceProjects;
}

/** The two ProjectApi reads, narrowed to the fields a grant binds; ProjectApi satisfies it. */
export interface CliDeviceProjects {
  findWithTeam(
    id: string,
  ): Promise<(AuthDirectoryProject & { team: { organizationId: string } }) | null>;
  findLiveByRef(
    input: Readonly<{ projectRef: string; organizationId: string }>,
  ): Promise<AuthDirectoryProject[]>;
}

/** The person is auth's own row; organizations and projects are asked of their owners. */
export class CliDeviceDirectoryService implements CliDeviceDirectory {
  static create(deps: CliDeviceDirectoryServiceDeps): CliDeviceDirectoryService {
    return new CliDeviceDirectoryService(deps);
  }

  private constructor(private readonly deps: CliDeviceDirectoryServiceDeps) {}

  async getOrganizationIdBySsoDomain(domain: string): Promise<string> {
    const organization = await this.deps.organizations.findBySsoDomain({ domain });
    if (organization === null) throw new OrganizationNotFoundError();
    return organization.id;
  }

  getPerson(userId: string): Promise<{ id: string; email: string | null; name: string | null }> {
    return this.deps.people.getPerson(userId);
  }

  async getOrganization(
    organizationId: string,
  ): Promise<{ id: string; name: string; slug: string }> {
    const summary = await this.deps.organizations.findProvisioningSummary(organizationId);
    if (summary === null) throw new OrganizationNotFoundError(organizationId);
    return { id: summary.id, name: summary.name, slug: summary.slug };
  }

  async maxSessionDurationDays(organizationId: string): Promise<number> {
    const policy = await this.deps.organizations.getSessionPolicy({ organizationId });
    return policy.maxSessionDurationDays;
  }

  hasActiveMembership(params: { userId: string; organizationId: string }): Promise<boolean> {
    return this.deps.organizations.isMember(params);
  }

  async findActiveMemberRole(params: {
    userId: string;
    organizationId: string;
  }): Promise<string | null> {
    try {
      const member = await this.deps.organizations.getMember(params);
      return member.disabledAt === null ? member.role : null;
    } catch (error) {
      if (HandledError.isHandled(error) && error.code === "member_not_found") return null;
      throw error;
    }
  }

  async getLiveProject({
    projectId,
    organizationId,
  }: {
    projectId: string;
    organizationId: string;
  }): Promise<AuthDirectoryProject> {
    const project = await this.deps.projects.findWithTeam(projectId);
    if (project === null || project.team.organizationId !== organizationId) {
      throw new ProjectNotFoundError();
    }
    return bindable(project);
  }

  async getLiveProjectByRef(params: {
    projectRef: string;
    organizationId: string;
  }): Promise<AuthDirectoryProject> {
    const [project] = await this.deps.projects.findLiveByRef(params);
    if (project === undefined) throw new ProjectNotFoundError();
    return bindable(project);
  }
}

function bindable(project: AuthDirectoryProject): AuthDirectoryProject {
  const { id, slug, name, teamId, isPersonal, ownerUserId } = project;
  return { id, slug, name, teamId, isPersonal, ownerUserId };
}
