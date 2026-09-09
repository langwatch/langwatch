import type { ProjectManagementDirectory } from "../../project.rest.ts";

/**
 * The five operations the management door reaches, so a transport suite stays
 * at that boundary: what a test cares about is overridden, the rest refuse by
 * name.
 */
export class TestProjectDirectory implements ProjectManagementDirectory {
  constructor(private readonly overrides: Partial<ProjectManagementDirectory> = {}) {}

  listByOrganization: ProjectManagementDirectory["listByOrganization"] = (input) =>
    this.overrides.listByOrganization?.(input) ?? this.unimplemented("listByOrganization");

  tryGetWithTeam: ProjectManagementDirectory["tryGetWithTeam"] = (id) =>
    this.overrides.tryGetWithTeam?.(id) ?? this.unimplemented("tryGetWithTeam");

  create: ProjectManagementDirectory["create"] = (input) =>
    this.overrides.create?.(input) ?? this.unimplemented("create");

  update: ProjectManagementDirectory["update"] = (input) =>
    this.overrides.update?.(input) ?? this.unimplemented("update");

  archive: ProjectManagementDirectory["archive"] = (input) =>
    this.overrides.archive?.(input) ?? this.unimplemented("archive");

  private unimplemented(operation: string): Promise<never> {
    return Promise.reject(new Error(`TestProjectDirectory does not implement ${operation}`));
  }
}
