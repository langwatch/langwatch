import type { InstanceIdentity, PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate, type Instant, toDate } from "@langwatch/time";

import type {
  InstanceIdentityRecord,
  InstanceIdentityRepository,
  InstanceReportSwitches,
} from "../instance-identity.repository.ts";

/** The fixed key, so the table can hold exactly one row. */
const ROW_ID = "self";

type InstanceIdentityDatabase = Pick<PrismaClient, "instanceIdentity">;

export class PrismaInstanceIdentityRepository implements InstanceIdentityRepository {
  static create(database: InstanceIdentityDatabase): PrismaInstanceIdentityRepository {
    return new PrismaInstanceIdentityRepository(database);
  }

  private constructor(private readonly prisma: InstanceIdentityDatabase) {}

  async findRow(): Promise<InstanceIdentityRecord | null> {
    const row = await this.prisma.instanceIdentity.findUnique({ where: { id: ROW_ID } });
    return row === null ? null : rowOf(row);
  }

  /**
   * Two processes starting at once both try to insert; one wins the primary key
   * and the other re-reads the winner's id, so the install never ends up with
   * two identities.
   */
  async mint(instanceId: string): Promise<InstanceIdentityRecord> {
    const existing = await this.findRow();
    if (existing) return existing;

    try {
      return rowOf(await this.prisma.instanceIdentity.create({ data: { id: ROW_ID, instanceId } }));
    } catch (error) {
      const winner = await this.findRow();
      if (!winner) throw error;
      return winner;
    }
  }

  async setReportSwitches({
    switches: { optionalMetricsOptOut, hostnameOptOut },
    instanceIdIfMissing,
  }: {
    switches: InstanceReportSwitches;
    instanceIdIfMissing: string;
  }): Promise<void> {
    const data = {
      ...(optionalMetricsOptOut === undefined ? {} : { optionalMetricsOptOut }),
      ...(hostnameOptOut === undefined ? {} : { hostnameOptOut }),
    };
    if (Object.keys(data).length === 0) return;
    await this.upsertRow({ instanceIdIfMissing, data });
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
    await this.upsertRow({
      instanceIdIfMissing,
      data: error
        ? { lastReportError: error }
        : { lastReportAt: toDate(at), lastReportError: null },
    });
  }

  /**
   * One statement on the fixed key, which Prisma runs as Postgres's native
   * `INSERT ... ON CONFLICT (id) DO UPDATE`: racing first writes land on one row.
   */
  private async upsertRow({
    instanceIdIfMissing,
    data,
  }: {
    instanceIdIfMissing: string;
    data: RowWrite;
  }): Promise<void> {
    await this.prisma.instanceIdentity.upsert({
      where: { id: ROW_ID },
      create: { id: ROW_ID, instanceId: instanceIdIfMissing, ...data },
      update: data,
    });
  }
}

type RowWrite = Partial<
  Pick<
    InstanceIdentity,
    "optionalMetricsOptOut" | "hostnameOptOut" | "lastReportAt" | "lastReportError"
  >
>;

function rowOf(row: InstanceIdentity): InstanceIdentityRecord {
  return {
    instanceId: row.instanceId,
    createdAt: fromDate(row.createdAt),
    lastReportAt: row.lastReportAt === null ? null : fromDate(row.lastReportAt),
    lastReportError: row.lastReportError,
    optionalMetricsOptOut: row.optionalMetricsOptOut,
    hostnameOptOut: row.hostnameOptOut,
  };
}
