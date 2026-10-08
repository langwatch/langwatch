import { ORGANIZATION_ID_PAGE_LIMIT } from "@langwatch/organization-contract";
import { Task } from "@langwatch/task";

import type { OrganizationModule } from "../app/organization.app.ts";

type BackfillPeers = Readonly<{
  organizations: Pick<OrganizationModule, "listAllIds" | "recordStoredPresenceSetting">;
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
    let after: string | undefined;
    do {
      const page = await this.peers.organizations.listAllIds({
        after,
        limit: ORGANIZATION_ID_PAGE_LIMIT,
      });
      for (const organizationId of page.ids) {
        signal.throwIfAborted();
        await this.peers.organizations.recordStoredPresenceSetting({ organizationId });
      }
      after = page.next ?? undefined;
    } while (after !== undefined);
  }
}
