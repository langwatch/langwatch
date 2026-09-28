// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  ScimCapabilityUnavailableError,
  type ScimSyncActivityEntry,
  type ScimSyncState,
} from "@langwatch/enterprise-scim-contract";

import type { ScimSyncActivityRepository } from "../repositories/scim-sync-activity.repository.ts";
import type { ScimSyncReadRepository } from "../repositories/scim-sync.repository.ts";

/**
 * Where directory syncs stand: an organization's own, for its reconciliation
 * view, and every organization's, for the platform operator (ADR-122).
 */
export class ScimSyncReadsService {
  static create(deps: {
    syncs: ScimSyncReadRepository;
    activity: ScimSyncActivityRepository | null;
  }): ScimSyncReadsService {
    return new ScimSyncReadsService(deps.syncs, deps.activity);
  }

  private constructor(
    private readonly syncs: ScimSyncReadRepository,
    private readonly activity: ScimSyncActivityRepository | null,
  ) {}

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
    return this.syncs.listPageForOperator(input);
  }

  findForOperator(input: { connectionId: string }): Promise<ScimSyncState[]> {
    return this.syncs.findByConnectionForOperator(input);
  }

  /** Refused by name where this process composed no event stack: an empty log would read
   *  as a quiet directory. */
  async findActivity(input: {
    organizationId: string;
    connectionId: string;
    limit: number;
  }): Promise<ScimSyncActivityEntry[]> {
    if (!this.activity) throw new ScimCapabilityUnavailableError("SCIM directory activity");
    return [...(await this.activity.findActivity(input))];
  }
}
