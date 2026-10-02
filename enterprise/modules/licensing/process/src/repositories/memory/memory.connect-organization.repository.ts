import type { Instant } from "@langwatch/time";

import type {
  ConnectOrganizationRecord,
  ConnectOrganizationRepository,
} from "../connect-organization.repository.ts";

/** The Connect state of each organization on this install, held in memory. */
export class MemoryConnectOrganizationRepository implements ConnectOrganizationRepository {
  #rows: Map<string, ConnectOrganizationRecord>;

  /** `rows` is shared, not copied: a test writes a licence onto it the way activation does. */
  static create({
    rows = new Map(),
  }: { rows?: Map<string, ConnectOrganizationRecord> } = {}): MemoryConnectOrganizationRepository {
    return new MemoryConnectOrganizationRepository(rows);
  }

  private constructor(rows: Map<string, ConnectOrganizationRecord>) {
    this.#rows = rows;
  }

  async findById(organizationId: string): Promise<ConnectOrganizationRecord | null> {
    return this.#rows.get(organizationId) ?? null;
  }

  async findLicensedOrganizationIds(): Promise<string[]> {
    return [...this.#rows.values()].filter((row) => row.license).map((row) => row.organizationId);
  }

  /** Refuses an unknown organization the way the unique key does. */
  async setServicesDisabled({
    organizationId,
    servicesDisabled,
  }: {
    organizationId: string;
    servicesDisabled: readonly string[];
  }): Promise<void> {
    const row = this.#rows.get(organizationId);
    if (!row) throw new Error(`no organization ${organizationId}`);
    this.#rows.set(organizationId, { ...row, servicesDisabled: [...servicesDisabled] });
  }

  async recordSyncOutcome({
    organizationId,
    at,
    error,
  }: {
    organizationId: string;
    at: Instant;
    error: string | null;
  }): Promise<void> {
    const row = this.#rows.get(organizationId);
    if (!row) throw new Error(`no organization ${organizationId}`);
    this.#rows.set(
      organizationId,
      error ? { ...row, lastSyncError: error } : { ...row, lastSyncAt: at, lastSyncError: null },
    );
  }
}
