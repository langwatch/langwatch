/**
 * The project fact steps' backfill: each organization's existing projects recorded as one fact
 * (created, department or presence), a page of organizations at a time, resuming after the last
 * page saved. Spec: modules/project/specs/project-service.feature
 */
import { ORGANIZATION_ID_PAGE_LIMIT, type OrganizationApi } from "@langwatch/organization-contract";

type ProjectFactsBackfillPeers = Readonly<{
  organizations: Pick<OrganizationApi, "listAllIds">;
  /** Records one organization's projects' fact; answers how many projects it recorded. */
  record: (input: { organizationId: string }) => Promise<number>;
  /** Counts what `record` would record, writing nothing; absent, a dry run counts no projects. */
  preview?: (input: { organizationId: string }) => Promise<number>;
}>;

/** How many of a page's organizations record at once; the checkpoint still waits for the page. */
const ORGANIZATION_WIDTH = 8;

type ProjectFactsBackfillReport = {
  afterOrganizationId: string | null;
  organizations: number;
  projects: number;
};

export class ProjectFactsBackfillService {
  private constructor(private readonly peers: ProjectFactsBackfillPeers) {}

  static create({ peers }: { peers: ProjectFactsBackfillPeers }): ProjectFactsBackfillService {
    return new ProjectFactsBackfillService(peers);
  }

  /**
   * Each organization after `after`, a page at a time; `onPage` hears the last organization of
   * each completed page, never on a dry run. Stops between organizations on abort.
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
  }): Promise<ProjectFactsBackfillReport> {
    const totals = { organizations: 0, projects: 0 };
    let cursor = after;
    let hasMore = true;
    while (hasMore && !signal.aborted) {
      const page = await this.peers.organizations.listAllIds({
        after: cursor,
        limit: ORGANIZATION_ID_PAGE_LIMIT,
      });
      const completed = await this.recordPage({ ids: page.ids, dryRun, signal, totals });
      const last = page.ids.at(-1);
      if (completed && last !== undefined) {
        cursor = last;
        if (!dryRun) await onPage({ afterOrganizationId: last });
      }
      hasMore = completed && page.next !== null;
    }
    return { afterOrganizationId: cursor ?? null, ...totals };
  }

  /** One page's organizations, a few at a time; false when the signal stopped it part way. */
  private async recordPage({
    ids,
    dryRun,
    signal,
    totals,
  }: {
    ids: readonly string[];
    dryRun: boolean;
    signal: AbortSignal;
    totals: { organizations: number; projects: number };
  }): Promise<boolean> {
    let done = 0;
    let failure: { error: unknown } | undefined;
    await eachInLanes({
      items: ids,
      width: ORGANIZATION_WIDTH,
      stop: () => signal.aborted || failure !== undefined,
      each: async (organizationId) => {
        let projects: number;
        try {
          projects = dryRun
            ? ((await this.peers.preview?.({ organizationId })) ?? 0)
            : await this.peers.record({ organizationId });
        } catch (error) {
          failure ??= { error };
          return;
        }
        // Added after the await: `+=` across an await would drop another lane's count.
        totals.projects += projects;
        totals.organizations += 1;
        done += 1;
      },
    });
    // Every lane has stopped before the step hears the failure, so none writes after it.
    if (failure) throw failure.error;
    return done === ids.length;
  }
}

/** Runs `each` over the items in order, at most `width` at once, taking none once `stop` says so. */
async function eachInLanes<Item>({
  items,
  width,
  stop,
  each,
}: {
  items: readonly Item[];
  width: number;
  stop: () => boolean;
  each: (item: Item) => Promise<void>;
}): Promise<void> {
  const pending = [...items];
  const lane = async (): Promise<void> => {
    while (pending.length > 0 && !stop()) {
      const item = pending.shift();
      if (item !== undefined) await each(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
}
