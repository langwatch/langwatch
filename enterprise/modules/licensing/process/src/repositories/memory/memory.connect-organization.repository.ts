import type { Instant } from "@langwatch/time";

import type {
  ConnectOrganizationRecord,
  ConnectOrganizationRepository,
} from "../connect-organization.repository.ts";

/** The Connect state of each organization on this install, held in memory. */
export class MemoryConnectOrganizationRepository implements ConnectOrganizationRepository {
  #rows: Map<string, ConnectOrganizationRecord>;

  static create(
    seed: readonly ConnectOrganizationRecord[] = [],
  ): MemoryConnectOrganizationRepository {
    return new MemoryConnectOrganizationRepository(
      new Map(seed.map((row) => [row.organizationId, row])),
    );
  }

  private constructor(rows: Map<string, ConnectOrganizationRecord>) {
    this.#rows = rows;
  }

  activate(organizationId: string, license: string): void {
    this.#rows.set(organizationId, {
      ...(this.#rows.get(organizationId) ?? blankRow(organizationId)),
      license,
    });
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

function blankRow(organizationId: string): ConnectOrganizationRecord {
  return {
    organizationId,
    license: null,
    servicesDisabled: [],
    lastSyncAt: null,
    lastSyncError: null,
  };
}
