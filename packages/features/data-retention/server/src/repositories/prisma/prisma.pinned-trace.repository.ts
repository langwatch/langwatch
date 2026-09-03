import {
  pinnedTraceSchema,
  type PinSource,
  type PinTraceInput,
  type PinnedTrace,
  type UnpinTraceInput,
} from "@langwatch/data-retention-contract";
import { PinnedTraceRepository } from "../pinned-trace.repository";
import type { DataRetentionDatabasePort } from "../../ports/data-retention-database.port";

function mapPinnedTrace(row: unknown): PinnedTrace {
  return pinnedTraceSchema.parse(row);
}

/** Private persistence for trace pin annotations owned by Data Retention. */
export class PrismaPinnedTraceRepository extends PinnedTraceRepository {
  static create(options: { database: DataRetentionDatabasePort }): PrismaPinnedTraceRepository {
    return new PrismaPinnedTraceRepository(options.database);
  }

  private constructor(private readonly database: DataRetentionDatabasePort) {
    super();
  }

  async tryFindByProjectAndTrace({
    projectId,
    traceId,
  }: UnpinTraceInput): Promise<PinnedTrace | null> {
    const row = await this.database.pinnedTrace.findUnique({
      where: { projectId_traceId: { projectId, traceId } },
    });
    return row ? mapPinnedTrace(row) : null;
  }

  async findAllByProject({ projectId }: { projectId: string }): Promise<PinnedTrace[]> {
    const rows = await this.database.pinnedTrace.findMany({ where: { projectId } });
    return rows.map(mapPinnedTrace);
  }

  async findAllTraceIds({ projectId }: { projectId: string }): Promise<string[]> {
    const pins = await this.database.pinnedTrace.findMany({
      where: { projectId },
      select: { traceId: true },
    });
    return pins.map((pin) => pinnedTraceSchema.pick({ traceId: true }).parse(pin).traceId);
  }

  async create(params: PinTraceInput & { source: PinSource }): Promise<PinnedTrace> {
    const row = await this.database.pinnedTrace.upsert({
      where: {
        projectId_traceId: {
          projectId: params.projectId,
          traceId: params.traceId,
        },
      },
      update:
        params.source === "manual"
          ? {
              ...(params.userId !== void 0 ? { userId: params.userId } : {}),
              source: "manual",
              reason: params.reason ?? null,
            }
          : {},
      create: {
        projectId: params.projectId,
        traceId: params.traceId,
        userId: params.userId ?? null,
        source: params.source,
        reason: params.reason ?? null,
      },
    });
    return mapPinnedTrace(row);
  }

  async delete({ projectId, traceId }: UnpinTraceInput): Promise<void> {
    await this.database.pinnedTrace.deleteMany({
      where: { projectId, traceId },
    });
  }

  async hasManualPin({ projectId, traceId }: UnpinTraceInput): Promise<boolean> {
    const pin = await this.tryFindByProjectAndTrace({ projectId, traceId });
    return pin != null && pin.source === "manual";
  }
}
