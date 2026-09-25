import type { ScimSyncState } from "@langwatch/identity-contract";

/**
 * What the directory-sync guards read (D08): the folded state of one
 * connection's sync. A port, not Prisma directly — the guards run on both
 * the calling path and the queue's staged re-run, and must reach one head.
 */
export abstract class ScimSyncReadRepository {
  /** `ScimSyncNotFoundError` when this organization holds no such sync. */
  abstract getSync(args: { scimSyncId: string; organizationId: string }): Promise<ScimSyncState>;

  /**
   * Every sync this organization holds, newest first. The read a peer module
   * composes a reconciliation view from: the directory module owns the people
   * it pushed, identity owns where each connection's sync stands.
   */
  abstract findForOrganization(args: { organizationId: string }): Promise<ScimSyncState[]>;

  /** The operator's cross-customer page (ADR-122), newest first. */
  abstract listPageForOperator(args: {
    page: number;
    pageSize: number;
    search?: string | undefined;
  }): Promise<{ syncs: ScimSyncState[]; total: number }>;

  /** One connection's sync, whichever organization holds it: none or one. */
  abstract findByConnectionForOperator(args: { connectionId: string }): Promise<ScimSyncState[]>;
}
