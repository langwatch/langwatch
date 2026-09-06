import type { ScimSyncState } from "@langwatch/identity";

/**
 * What the directory-sync guards read (D08): the folded state of one
 * connection's sync. A port rather than Prisma, for the reason every guard
 * port here is one — the guards run on the calling path AND on the queue's
 * staged re-run, and both legs have to reach the same head.
 */
export interface ScimSyncReadRepository {
  findSync(args: {
    scimSyncId: string;
    organizationId: string;
  }): Promise<ScimSyncState | null>;
}
