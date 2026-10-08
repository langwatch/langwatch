import { createLogger, type Logger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { Task } from "@langwatch/task";

import type { ProjectModule } from "../app/project.app.ts";

const defaultLogger: Logger = createLogger("langwatch:task:backfill-project-created");

type BackfillPeers = Readonly<{
  organizations: Pick<OrganizationApi, "findAllIds">;
  projects: Pick<ProjectModule, "recordExistingProjectsCreated">;
  logger?: Pick<Logger, "info">;
}>;

/**
 * Records every existing project's `lw.project.created`, marked backfilled and naming the
 * organization's admin, so peers that learn from the event (nurturing) know them. Safe to re-run.
 * `--dry-run` counts the projects it would record and logs them, recording nothing.
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

  async run({ args, signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const isDryRun = args.includes("--dry-run");
    let organizations = 0;
    let projects = 0;
    for (const organizationId of await this.peers.organizations.findAllIds()) {
      signal.throwIfAborted();
      projects += await this.peers.projects.recordExistingProjectsCreated({
        organizationId,
        isDryRun,
      });
      organizations += 1;
    }
    (this.peers.logger ?? defaultLogger).info(
      { isDryRun, organizations, projects },
      isDryRun
        ? "project created backfill dry run: nothing recorded"
        : "project created backfill recorded every project",
    );
  }
}
