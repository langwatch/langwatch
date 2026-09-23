import { type Instant, nowInstant } from "@langwatch/time";

import type {
  InstanceIdentityRecord,
  InstanceIdentityRepository,
  InstanceReportSwitches,
} from "../instance-identity.repository.ts";

/**
 * The one row, held in memory. The table's single-row constraint is the point
 * of the prisma twin, so it is kept here too: `mint` answers the identity that
 * is already there rather than replacing it.
 */
export class MemoryInstanceIdentityRepository implements InstanceIdentityRepository {
  #row: InstanceIdentityRecord | null = null;

  static create({
    now = nowInstant,
    seed,
  }: {
    now?: () => Instant;
    seed?: Partial<InstanceIdentityRecord> & { instanceId: string };
  } = {}): MemoryInstanceIdentityRepository {
    const repository = new MemoryInstanceIdentityRepository(now);
    if (seed) repository.#row = { ...blankRow(seed.instanceId, now()), ...seed };
    return repository;
  }

  private constructor(private readonly now: () => Instant) {}

  async findRow(): Promise<InstanceIdentityRecord | null> {
    return this.#row;
  }

  async mint(instanceId: string): Promise<InstanceIdentityRecord> {
    this.#row ??= blankRow(instanceId, this.now());
    return this.#row;
  }

  async acknowledgeStartupNotice({
    instanceId,
    schemaVersion,
  }: {
    instanceId: string;
    schemaVersion: number;
  }): Promise<void> {
    const row = this.#row ?? blankRow(instanceId, this.now());
    this.#row = { ...row, startupNoticeAcknowledgedSchemaVersion: schemaVersion };
  }

  async setReportSwitches({
    optionalMetricsOptOut,
    hostnameOptOut,
  }: InstanceReportSwitches): Promise<void> {
    if (!this.#row) return;
    this.#row = {
      ...this.#row,
      ...(optionalMetricsOptOut === undefined ? {} : { optionalMetricsOptOut }),
      ...(hostnameOptOut === undefined ? {} : { hostnameOptOut }),
    };
  }

  async recordReport({ error, at }: { error: string | null; at: Instant }): Promise<void> {
    if (!this.#row) return;
    this.#row = error
      ? { ...this.#row, lastReportError: error }
      : { ...this.#row, lastReportAt: at, lastReportError: null };
  }
}

function blankRow(instanceId: string, createdAt: Instant): InstanceIdentityRecord {
  return {
    instanceId,
    createdAt,
    lastReportAt: null,
    lastReportError: null,
    optionalMetricsOptOut: false,
    hostnameOptOut: false,
    startupNoticeAcknowledgedSchemaVersion: 0,
  };
}
