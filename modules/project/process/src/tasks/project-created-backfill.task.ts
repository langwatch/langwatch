import type { OrganizationApi } from "@langwatch/organization-contract";
import { Task } from "@langwatch/task";

import type { ProjectModule } from "../app/project.app.ts";

type BackfillPeers = Readonly<{
  organizations: Pick<OrganizationApi, "findAllIds">;
  projects: Pick<ProjectModule, "recordExistingProjectsCreated">;
}>;

/**
 * Records every existing project's `lw.project.created`, marked backfilled and naming the
 * organization's admin, so peers that learn from the event (nurturing) know them. Safe to re-run.
 */
export class ProjectCreatedBackfillTask extends Task {
  readonly name = "backfill-project-created";
  readonly description = "Records every existing project as created, for peers that react to it.";

  private constructor(private readonly peers: BackfillPeers) {
    super();
  }

  static create(peers: BackfillPeers): ProjectCreatedBackfillTask {
    return new ProjectCreatedBackfillTask(peers);
  }

  async run({ signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    for (const organizationId of await this.peers.organizations.findAllIds()) {
      signal.throwIfAborted();
      await this.peers.projects.recordExistingProjectsCreated({ organizationId });
    }
  }
}
