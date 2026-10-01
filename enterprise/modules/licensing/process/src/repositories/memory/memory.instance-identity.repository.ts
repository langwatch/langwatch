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

  async setReportSwitches({
    switches: { optionalMetricsOptOut, hostnameOptOut },
    instanceIdIfMissing,
  }: {
    switches: InstanceReportSwitches;
    instanceIdIfMissing: string;
  }): Promise<void> {
    const row = await this.mint(instanceIdIfMissing);
    this.#row = {
      ...row,
      ...(optionalMetricsOptOut === undefined ? {} : { optionalMetricsOptOut }),
      ...(hostnameOptOut === undefined ? {} : { hostnameOptOut }),
    };
  }

  async recordReport({
    error,
    at,
    instanceIdIfMissing,
  }: {
    error: string | null;
    at: Instant;
    instanceIdIfMissing: string;
  }): Promise<void> {
    const row = await this.mint(instanceIdIfMissing);
    this.#row = error
      ? { ...row, lastReportError: error }
      : { ...row, lastReportAt: at, lastReportError: null };
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
  };
}
