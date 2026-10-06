import type { OrganizationApi } from "@langwatch/organization-contract";
import { Task } from "@langwatch/task";

import type { ProjectModule } from "../app/project.app.ts";

type BackfillPeers = Readonly<{
  organizations: Pick<OrganizationApi, "findAllIds">;
  projects: Pick<ProjectModule, "recordExistingPresenceSettings">;
}>;

/**
 * Records every existing project's stored presence setting as
 * `lw.project.presence_setting_changed`, marked backfilled, so presence can fold it. Keyed once
 * per project: a re-run records nothing new.
 */
export class ProjectPresenceSettingBackfillTask extends Task {
  readonly name = "backfill-project-presence-setting";
  readonly description = "Records every existing project's presence setting, for presence to fold.";

  private constructor(private readonly peers: BackfillPeers) {
    super();
  }

  static create(peers: BackfillPeers): ProjectPresenceSettingBackfillTask {
    return new ProjectPresenceSettingBackfillTask(peers);
  }

  async run({ signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    for (const organizationId of await this.peers.organizations.findAllIds()) {
      signal.throwIfAborted();
      await this.peers.projects.recordExistingPresenceSettings({ organizationId });
    }
  }
}
