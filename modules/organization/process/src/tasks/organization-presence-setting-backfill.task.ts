import { Task } from "@langwatch/task";

import type { OrganizationModule } from "../app/organization.app.ts";

type BackfillPeers = Readonly<{
  organizations: Pick<OrganizationModule, "findAllIds" | "recordStoredPresenceSetting">;
}>;

/**
 * Records every existing organization's stored presence setting as
 * `lw.organization.presence_setting_changed`, marked backfilled, so presence can fold it. Keyed
 * once per organization: a re-run records nothing new.
 */
export class OrganizationPresenceSettingBackfillTask extends Task {
  readonly name = "backfill-organization-presence-setting";
  readonly description =
    "Records every existing organization's presence setting, for presence to fold.";

  private constructor(private readonly peers: BackfillPeers) {
    super();
  }

  static create(peers: BackfillPeers): OrganizationPresenceSettingBackfillTask {
    return new OrganizationPresenceSettingBackfillTask(peers);
  }

  async run({ signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    for (const organizationId of await this.peers.organizations.findAllIds()) {
      signal.throwIfAborted();
      await this.peers.organizations.recordStoredPresenceSetting({ organizationId });
    }
  }
}
