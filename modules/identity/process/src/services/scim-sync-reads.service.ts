import type { ScimSyncReadsApi, ScimSyncState } from "@langwatch/identity-contract";

import type { ScimSyncReadRepository } from "../repositories/scim-sync.repository.ts";

/**
 * Where an organization's directory syncs stand, as a peer is answered.
 * Identity owns the folded state; the directory module composes its
 * reconciliation view from this beside the people it pushed itself.
 */
export class ScimSyncReadsService implements ScimSyncReadsApi {
  static create(deps: { syncs: ScimSyncReadRepository }): ScimSyncReadsService {
    return new ScimSyncReadsService(deps.syncs);
  }

  private constructor(private readonly syncs: ScimSyncReadRepository) {}

  /** Newest first. Empty where the organization has never synced. */
  async findForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ScimSyncState[]> {
    return this.syncs.findForOrganization({ organizationId });
  }

  /**
   * Filtered from the organization's own page rather than read by connection:
   * an organization holds a handful of connections, and one read that is
   * always tenant-scoped cannot be asked for another organization's sync.
   */
  async findByConnection({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<ScimSyncState | null> {
    const syncs = await this.syncs.findForOrganization({ organizationId });
    return syncs.find((sync) => sync.connectionId === connectionId) ?? null;
  }

  listForOperator(input: {
    page: number;
    pageSize: number;
    search?: string | undefined;
  }): Promise<{ syncs: ScimSyncState[]; total: number }> {
    return this.syncs.findPageForOperator(input);
  }

  findForOperator(input: { connectionId: string }): Promise<ScimSyncState[]> {
    return this.syncs.findByConnectionForOperator(input);
  }
}
