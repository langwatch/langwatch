/**
 * The presence-setting step's backfill: organizations' stored presence settings recorded as their
 * fact, a page at a time in one batch per page, resuming after the last page saved.
 * Spec: modules/organization/specs/organization-service.feature
 */

/** How many organizations one page reads and sends as one batch. */
const PAGE_SIZE = 2000;

type OrganizationPresenceSettingBackfillPeers = Readonly<{
  /** Records one page after the cursor, or only reads it on a dry run; keyed per organization. */
  recordPage: (input: {
    afterOrganizationId: string | null;
    limit: number;
    dryRun: boolean;
  }) => Promise<{ lastOrganizationId: string | null; organizations: number }>;
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
   * Each page after `after`; `onPage` hears the last organization of each recorded page. A dry
   * run counts organizations, records nothing and saves nothing. Stops between pages on abort.
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
    let cursor: string | null = after ?? null;
    while (!signal.aborted) {
      const page = await this.peers.recordPage({
        afterOrganizationId: cursor,
        limit: PAGE_SIZE,
        dryRun,
      });
      if (page.lastOrganizationId === null) break;
      organizations += page.organizations;
      if (!dryRun) recorded += page.organizations;
      cursor = page.lastOrganizationId;
      if (!dryRun) await onPage({ afterOrganizationId: cursor });
    }
    return { afterOrganizationId: cursor, organizations, recorded };
  }
}
