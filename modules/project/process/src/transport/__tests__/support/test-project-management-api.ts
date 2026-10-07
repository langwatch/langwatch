import type { ProjectManagementApi } from "../../project.rest.ts";

/**
 * The five operations the management door reaches, keeping a transport
 * suite at that boundary — cared-about answers overridden, the rest refuse
 * by name. Typed against the door's witness, so a served member is one production serves too.
 */
export class TestProjectManagementApi implements ProjectManagementApi {
  constructor(private readonly overrides: Partial<ProjectManagementApi> = {}) {}

  findWithTeam: ProjectManagementApi["findWithTeam"] = (id) =>
    this.overrides.findWithTeam?.(id) ?? this.unimplemented("findWithTeam");

  updateInOrganization: ProjectManagementApi["updateInOrganization"] = (input) =>
    this.overrides.updateInOrganization?.(input) ?? this.unimplemented("updateInOrganization");

  archiveInOrganization: ProjectManagementApi["archiveInOrganization"] = (input) =>
    this.overrides.archiveInOrganization?.(input) ?? this.unimplemented("archiveInOrganization");

  getPiiRedactionLevel: ProjectManagementApi["getPiiRedactionLevel"] = (input) =>
    this.overrides.getPiiRedactionLevel?.(input) ?? this.unimplemented("getPiiRedactionLevel");

  setPiiRedactionLevel: ProjectManagementApi["setPiiRedactionLevel"] = (input) =>
    this.overrides.setPiiRedactionLevel?.(input) ?? this.unimplemented("setPiiRedactionLevel");

  private unimplemented(operation: string): Promise<never> {
    return Promise.reject(new Error(`TestProjectManagementApi does not implement ${operation}`));
  }
}
