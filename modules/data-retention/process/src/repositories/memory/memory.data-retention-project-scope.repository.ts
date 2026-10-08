import type {
  DataRetentionProjectPlacement,
  DataRetentionProjectScopeRepository,
} from "../data-retention-project-scope.repository.ts";

export type MemoryRetentionTeamRow = Readonly<{ teamId: string; organizationId: string }>;

/** Project and team rows a test put there, as project's and organization's tables hold them. */
export class MemoryDataRetentionProjectScopeRepository implements DataRetentionProjectScopeRepository {
  static create({
    projects = [],
    teams = [],
  }: {
    projects?: readonly DataRetentionProjectPlacement[];
    teams?: readonly MemoryRetentionTeamRow[];
  } = {}): MemoryDataRetentionProjectScopeRepository {
    return new MemoryDataRetentionProjectScopeRepository({ projects, teams });
  }

  readonly #projects: Map<string, DataRetentionProjectPlacement>;
  readonly #teams: Map<string, string>;

  private constructor({
    projects,
    teams,
  }: {
    projects: readonly DataRetentionProjectPlacement[];
    teams: readonly MemoryRetentionTeamRow[];
  }) {
    this.#projects = new Map(projects.map((project) => [project.projectId, project]));
    this.#teams = new Map([
      ...projects.map((project): [string, string] => [project.teamId, project.organizationId]),
      ...teams.map((team): [string, string] => [team.teamId, team.organizationId]),
    ]);
  }

  async findProjectPlacement({
    projectId,
  }: {
    projectId: string;
  }): Promise<DataRetentionProjectPlacement | null> {
    return this.#projects.get(projectId) ?? null;
  }

  async findTeamOrganizationId({ teamId }: { teamId: string }): Promise<string | null> {
    return this.#teams.get(teamId) ?? null;
  }

  async findProjectIds({
    organizationId,
    teamId,
  }: {
    organizationId: string;
    teamId?: string;
  }): Promise<string[]> {
    return [...this.#projects.values()]
      .filter((project) => project.organizationId === organizationId)
      .filter((project) => teamId === undefined || project.teamId === teamId)
      .map((project) => project.projectId);
  }
}
