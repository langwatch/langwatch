import type { ScimSyncActivityEntry } from "@langwatch/identity-contract";

/**
 * A connection's directory-sync log, read as a sequence (ADR-126). The
 * projection answers where the sync stands; this answers what the directory
 * did, in order, and that question is the log itself.
 */
export abstract class ScimSyncActivityRepository {
  /** Newest first, at most `limit`, scanned in the organization's tenant. */
  abstract findActivity(args: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<readonly ScimSyncActivityEntry[]>;
}
