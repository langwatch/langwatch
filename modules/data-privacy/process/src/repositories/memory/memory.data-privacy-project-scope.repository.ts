import type {
  DataPrivacyProjectScope,
  DataPrivacyProjectScopeRepository,
} from "../data-privacy-project-scope.repository.ts";

/** Project rows a test put there, as project's and organization's tables place them. */
export class MemoryDataPrivacyProjectScopeRepository implements DataPrivacyProjectScopeRepository {
  static create({
    projects = [],
  }: {
    projects?: readonly DataPrivacyProjectScope[];
  } = {}): MemoryDataPrivacyProjectScopeRepository {
    return new MemoryDataPrivacyProjectScopeRepository(projects);
  }

  readonly #rows: Map<string, DataPrivacyProjectScope>;

  private constructor(projects: readonly DataPrivacyProjectScope[]) {
    this.#rows = new Map(projects.map((project) => [project.projectId, project]));
  }

  /** Puts, moves or archives a project, as a row written by project. */
  put(project: DataPrivacyProjectScope): void {
    this.#rows.set(project.projectId, project);
  }

  async find({ projectId }: { projectId: string }): Promise<DataPrivacyProjectScope | null> {
    return this.#rows.get(projectId) ?? null;
  }
}
