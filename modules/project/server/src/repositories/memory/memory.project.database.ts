import type { Project, Team } from "@langwatch/project-contract";

/**
 * The organization columns the project reads reach through a team: the two
 * effective toggles and the admin the first-trace milestone is told about.
 */
export type MemoryOrganizationRow = Readonly<{
  id: string;
  name: string;
  presenceEnabled: boolean;
  traceSharingEnabled: boolean;
  /** Admin members oldest first, which is the order the Prisma read takes one in. */
  adminUserIds: readonly string[];
}>;

/**
 * The rows the project repositories share when the module is installed over
 * memory. One store, because a project is only ever read with its team and
 * that team's organization.
 */
export class MemoryProjectDatabase {
  readonly #projects = new Map<string, Project>();
  readonly #teams = new Map<string, Team>();
  readonly #organizations = new Map<string, MemoryOrganizationRow>();

  private constructor() {}

  static create(): MemoryProjectDatabase {
    return new MemoryProjectDatabase();
  }

  projects(): Project[] {
    return [...this.#projects.values()];
  }

  findProject(id: string): Project | undefined {
    return this.#projects.get(id);
  }

  putProject(project: Project): Project {
    this.#projects.set(project.id, project);

    return project;
  }

  teams(): Team[] {
    return [...this.#teams.values()];
  }

  findTeam(id: string): Team | undefined {
    return this.#teams.get(id);
  }

  putTeam(team: Team): Team {
    this.#teams.set(team.id, team);

    return team;
  }

  findOrganization(id: string): MemoryOrganizationRow | undefined {
    return this.#organizations.get(id);
  }

  putOrganization(organization: MemoryOrganizationRow): MemoryOrganizationRow {
    this.#organizations.set(organization.id, organization);

    return organization;
  }

  /** The organization a project belongs to, through its team. */
  findOrganizationOf(project: Project): MemoryOrganizationRow | undefined {
    const team = this.#teams.get(project.teamId);

    return team ? this.#organizations.get(team.organizationId) : undefined;
  }

  /** Whether a project's team sits in the named organization. */
  isInOrganization(project: Project, organizationId: string): boolean {
    return this.#teams.get(project.teamId)?.organizationId === organizationId;
  }
}
