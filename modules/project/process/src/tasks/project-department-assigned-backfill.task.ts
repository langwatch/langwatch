import type { OrganizationApi } from "@langwatch/organization-contract";
import { Task } from "@langwatch/task";

import type { ProjectModule } from "../app/project.app.ts";

type BackfillPeers = Readonly<{
  organizations: Pick<OrganizationApi, "findAllIds">;
  projects: Pick<ProjectModule, "recordExistingDepartmentAssignments">;
}>;

/**
 * Records every existing project's stored department, team and personal flag as
 * `lw.project.department_assigned`, marked backfilled, so data privacy can fold where each project
 * sits. Keyed once per project: a re-run records nothing new.
 */
export class ProjectDepartmentAssignedBackfillTask extends Task {
  readonly name = "backfill-project-department-assigned";
  readonly description =
    "Records every existing project's department and team, for data privacy to fold.";

  private constructor(private readonly peers: BackfillPeers) {
    super();
  }

  static create(peers: BackfillPeers): ProjectDepartmentAssignedBackfillTask {
    return new ProjectDepartmentAssignedBackfillTask(peers);
  }

  async run({ signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    for (const organizationId of await this.peers.organizations.findAllIds()) {
      signal.throwIfAborted();
      await this.peers.projects.recordExistingDepartmentAssignments({ organizationId });
    }
  }
}
