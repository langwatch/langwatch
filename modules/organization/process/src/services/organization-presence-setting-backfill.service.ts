/**
 * The presence-setting step's backfill: each organization's stored presence setting recorded as
 * its fact, a page of organizations at a time, resuming after the last page saved.
 * Spec: modules/organization/specs/organization-service.feature
 */
import { ORGANIZATION_ID_PAGE_LIMIT, type OrganizationApi } from "@langwatch/organization-contract";

type OrganizationPresenceSettingBackfillPeers = Readonly<{
  organizations: Pick<OrganizationApi, "listAllIds">;
  /** Records one organization's stored presence setting; keyed once per organization. */
  record: (input: { organizationId: string }) => Promise<boolean>;
}>;

type OrganizationPresenceSettingBackfillReport = {
  afterOrganizationId: string | null;
  organizations: number;
  recorded: number;
};

export class OrganizationPresenceSettingBackfillService {
  private constructor(private readonly peers: OrganizationPresenceSettingBackfillPeers) {}

  static create({
    peers,
  }: {
    peers: OrganizationPresenceSettingBackfillPeers;
  }): OrganizationPresenceSettingBackfillService {
    return new OrganizationPresenceSettingBackfillService(peers);
  }

  /**
   * Each organization after `after`, a page at a time; `onPage` hears the last organization of
   * each completed page. A dry run counts organizations, records nothing and saves nothing.
   */
  async backfill({
    after,
    dryRun,
    signal,
    onPage,
  }: {
    after: string | undefined;
    dryRun: boolean;
    signal: AbortSignal;
    onPage: (page: { afterOrganizationId: string }) => Promise<void>;
  }): Promise<OrganizationPresenceSettingBackfillReport> {
    let organizations = 0;
    let recorded = 0;
    let cursor = after;
    let hasMore = true;
    while (hasMore && !signal.aborted) {
      const page = await this.peers.organizations.listAllIds({
        after: cursor,
        limit: ORGANIZATION_ID_PAGE_LIMIT,
      });
      const pass = await recordPage({ ids: page.ids, dryRun, signal, record: this.peers.record });
      const completed = pass.completed;
      organizations += pass.organizations;
      recorded += pass.recorded;
      const last = page.ids.at(-1);
      if (completed && last !== undefined) {
        cursor = last;
        if (!dryRun) await onPage({ afterOrganizationId: last });
      }
      hasMore = completed && page.next !== null;
    }
    return { afterOrganizationId: cursor ?? null, organizations, recorded };
  }
}

/** One page's organizations in order; `completed` is false when an abort stopped it early. */
async function recordPage({
  ids,
  dryRun,
  signal,
  record,
}: {
  ids: readonly string[];
  dryRun: boolean;
  signal: AbortSignal;
  record: OrganizationPresenceSettingBackfillPeers["record"];
}): Promise<{ completed: boolean; organizations: number; recorded: number }> {
  let organizations = 0;
  let recorded = 0;
  for (const organizationId of ids) {
    if (signal.aborted) return { completed: false, organizations, recorded };
    if (!dryRun && (await record({ organizationId }))) recorded += 1;
    organizations += 1;
  }
  return { completed: true, organizations, recorded };
}
