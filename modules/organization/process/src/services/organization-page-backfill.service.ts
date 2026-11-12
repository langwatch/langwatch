/**
 * A backfill over every organization, a page at a time, resuming after the last page saved: the
 * presence-setting step and the seat-peak opening step (ADR-002 §5) each name their page.
 * Spec: modules/organization/specs/organization-service.feature, seat-peak.feature
 */

type OrganizationPageBackfillPeers = Readonly<{
  /** Acts on one page after the cursor, or only reads it on a dry run; `changed` it acted on. */
  page: (input: {
    afterOrganizationId: string | null;
    limit: number;
    dryRun: boolean;
  }) => Promise<{ lastOrganizationId: string | null; organizations: number; changed: number }>;
}>;

type OrganizationPageBackfillReport = {
  afterOrganizationId: string | null;
  organizations: number;
  changed: number;
};

export class OrganizationPageBackfillService {
  private constructor(
    private readonly peers: OrganizationPageBackfillPeers,
    private readonly pageSize: number,
  ) {}

  static create({
    peers,
    pageSize,
  }: {
    peers: OrganizationPageBackfillPeers;
    pageSize: number;
  }): OrganizationPageBackfillService {
    return new OrganizationPageBackfillService(peers, pageSize);
  }

  /**
   * Each page after `after`; `onPage` hears the last organization of each page acted on. A dry
   * run counts organizations, changes nothing and saves nothing. Stops between pages on abort.
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
  }): Promise<OrganizationPageBackfillReport> {
    let organizations = 0;
    let changed = 0;
    let cursor: string | null = after ?? null;
    while (!signal.aborted) {
      const page = await this.peers.page({
        afterOrganizationId: cursor,
        limit: this.pageSize,
        dryRun,
      });
      if (page.lastOrganizationId === null) break;
      organizations += page.organizations;
      changed += page.changed;
      cursor = page.lastOrganizationId;
      if (!dryRun) await onPage({ afterOrganizationId: cursor });
    }
    return { afterOrganizationId: cursor, organizations, changed };
  }
}
