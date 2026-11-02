/**
 * The seat-peak opening step's backfill (ADR-002 §5): every organization not yet counted is
 * snapshotted, a page at a time, resuming after the last page saved.
 * Spec: modules/organization/specs/seat-peak.feature
 */

/** How many organizations one page reads and snapshots. */
const PAGE_SIZE = 200;

type SeatPeakOpeningBackfillPeers = Readonly<{
  /** Opens one page after the cursor, or only reads it on a dry run. */
  openPage: (input: {
    afterOrganizationId: string | null;
    limit: number;
    dryRun: boolean;
  }) => Promise<{ lastOrganizationId: string | null; organizations: number; opened: number }>;
}>;

type SeatPeakOpeningBackfillReport = {
  afterOrganizationId: string | null;
  organizations: number;
  opened: number;
};

export class SeatPeakOpeningBackfillService {
  private constructor(private readonly peers: SeatPeakOpeningBackfillPeers) {}

  static create({
    peers,
  }: {
    peers: SeatPeakOpeningBackfillPeers;
  }): SeatPeakOpeningBackfillService {
    return new SeatPeakOpeningBackfillService(peers);
  }

  /**
   * Each page after `after`; `onPage` hears the last organization of each opened page. A dry run
   * counts organizations, opens nothing and saves nothing. Stops between pages on abort.
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
  }): Promise<SeatPeakOpeningBackfillReport> {
    let organizations = 0;
    let opened = 0;
    let cursor: string | null = after ?? null;
    while (!signal.aborted) {
      const page = await this.peers.openPage({
        afterOrganizationId: cursor,
        limit: PAGE_SIZE,
        dryRun,
      });
      if (page.lastOrganizationId === null) break;
      organizations += page.organizations;
      opened += page.opened;
      cursor = page.lastOrganizationId;
      if (!dryRun) await onPage({ afterOrganizationId: cursor });
    }
    return { afterOrganizationId: cursor, organizations, opened };
  }
}
