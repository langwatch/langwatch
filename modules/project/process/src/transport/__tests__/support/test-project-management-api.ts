import type { ProjectManagementApi } from "../../project.rest.ts";

/**
 * The seven operations the management door reaches, keeping a transport
 * suite at that boundary — cared-about answers overridden, the rest refuse
 * by name. Typed against the door's witness, so a served member is one production serves too.
 */
export class TestProjectManagementApi implements ProjectManagementApi {
  constructor(private readonly overrides: Partial<ProjectManagementApi> = {}) {}

  listByOrganization: ProjectManagementApi["listByOrganization"] = (input) =>
    this.overrides.listByOrganization?.(input) ?? this.unimplemented("listByOrganization");

  findWithTeam: ProjectManagementApi["findWithTeam"] = (id) =>
    this.overrides.findWithTeam?.(id) ?? this.unimplemented("findWithTeam");

  createInOrganization: ProjectManagementApi["createInOrganization"] = (input) =>
    this.overrides.createInOrganization?.(input) ?? this.unimplemented("createInOrganization");

  updateInOrganization: ProjectManagementApi["updateInOrganization"] = (input) =>
    this.overrides.updateInOrganization?.(input) ?? this.unimplemented("updateInOrganization");

  archiveInOrganization: ProjectManagementApi["archiveInOrganization"] = (input) =>
    this.overrides.archiveInOrganization?.(input) ?? this.unimplemented("archiveInOrganization");

  resolveVisibleProjects: ProjectManagementApi["resolveVisibleProjects"] = (input) =>
    this.overrides.resolveVisibleProjects?.(input) ?? this.unimplemented("resolveVisibleProjects");

  provisionServiceKey: ProjectManagementApi["provisionServiceKey"] = (input) =>
    this.overrides.provisionServiceKey?.(input) ?? this.unimplemented("provisionServiceKey");

  private unimplemented(operation: string): Promise<never> {
    return Promise.reject(new Error(`TestProjectManagementApi does not implement ${operation}`));
  }
}
