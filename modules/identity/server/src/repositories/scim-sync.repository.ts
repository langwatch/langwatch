import type { ScimSyncState } from "@langwatch/identity-contract";

/**
 * What the directory-sync guards read (D08): the folded state of one
 * connection's sync. A port, not Prisma directly — the guards run on both
 * the calling path and the queue's staged re-run, and must reach one head.
 */
export abstract class ScimSyncReadRepository {
  abstract tryFindSync(args: {
    scimSyncId: string;
    organizationId: string;
  }): Promise<ScimSyncState | null>;
}
