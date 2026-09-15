import {
  pinnedTraceSchema,
  type PinSource,
  type PinTraceInput,
  type PinnedTrace,
  type UnpinTraceInput,
} from "@langwatch/data-retention-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { PinnedTraceRepository } from "../pinned-trace.repository.ts";

/** Private persistence for trace pin annotations owned by Data Retention. */
export class PrismaPinnedTraceRepository
  extends PrismaRepository.for("PinnedTrace")
  implements PinnedTraceRepository
{
  static readonly create = this.factory((prisma) => new PrismaPinnedTraceRepository(prisma));

  async findByProjectAndTrace({
    projectId,
    traceId,
  }: UnpinTraceInput): Promise<PinnedTrace | null> {
    const row = await this.prisma.pinnedTrace.findUnique({
      where: { projectId_traceId: { projectId, traceId } },
    });

    return row ? pinnedTraceSchema.parse(row) : null;
  }

  async findAllByProject({ projectId }: { projectId: string }): Promise<PinnedTrace[]> {
    const rows = await this.prisma.pinnedTrace.findMany({ where: { projectId } });

    return rows.map((row) => pinnedTraceSchema.parse(row));
  }

  async findAllTraceIds({ projectId }: { projectId: string }): Promise<string[]> {
    const pins = await this.prisma.pinnedTrace.findMany({
      where: { projectId },
      select: { traceId: true },
    });

    return pins.map((pin) => pinnedTraceSchema.pick({ traceId: true }).parse(pin).traceId);
  }

  async create(params: PinTraceInput & { source: PinSource }): Promise<PinnedTrace> {
    const row = await this.prisma.pinnedTrace.upsert({
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

    return pinnedTraceSchema.parse(row);
  }

  async delete({ projectId, traceId }: UnpinTraceInput): Promise<void> {
    await this.prisma.pinnedTrace.deleteMany({
      where: { projectId, traceId },
    });
  }

  async hasManualPin({ projectId, traceId }: UnpinTraceInput): Promise<boolean> {
    const pin = await this.findByProjectAndTrace({ projectId, traceId });

    return pin != null && pin.source === "manual";
  }
}
