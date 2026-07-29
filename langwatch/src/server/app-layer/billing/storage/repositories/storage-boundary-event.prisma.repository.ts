import { Prisma, type PrismaClient } from "@prisma/client";

import { buildDedupKey } from "../boundaryEventIdentity";
import type {
  AppendBoundaryEventInput,
  StorageBoundaryEventRepository,
  StoredBoundaryEvent,
} from "./storage-boundary-event.repository";

export class PrismaStorageBoundaryEventRepository
  implements StorageBoundaryEventRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async append(input: AppendBoundaryEventInput): Promise<{ applied: boolean }> {
    const dedupKey = buildDedupKey(input);

    try {
      await this.prisma.$transaction([
        this.prisma.storageBoundaryEvent.create({
          data: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            category: input.category,
            partitionKey: input.partitionKey,
            sliceDate: input.sliceDate,
            retentionDays: input.retentionDays,
            edge: input.edge,
            deltaBytes: input.deltaBytes,
            dedupKey,
            occurredAt: input.occurredAt,
          },
        }),
        // Atomic increment — never read-modify-write (ADR-039 Decision 4).
        this.prisma.storageBillableGauge.upsert({
          where: { organizationId: input.organizationId },
          create: {
            organizationId: input.organizationId,
            billableBytes: input.deltaBytes,
            lastEventAt: input.occurredAt,
          },
          update: {
            billableBytes: { increment: input.deltaBytes },
            lastEventAt: input.occurredAt,
          },
        }),
      ]);
      return { applied: true };
    } catch (error) {
      // Unique violation ON dedupKey = a replay of an already-applied event.
      // The transaction rolled back as a whole: neither the event nor the
      // gauge increment landed, so replays are exact no-ops. The constraint
      // check is deliberately narrow — swallowing a P2002 from any OTHER
      // unique index added later would silently drop a real event's gauge
      // increment: permanent under-billing, the exact drift class this
      // design exists to prevent.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        (error.meta?.target as string[] | undefined)?.includes("dedupKey")
      ) {
        return { applied: false };
      }
      throw error;
    }
  }

  async findAllByOrganization({
    organizationId,
    upTo,
  }: {
    organizationId: string;
    upTo?: Date;
  }): Promise<StoredBoundaryEvent[]> {
    return await this.prisma.storageBoundaryEvent.findMany({
      where: {
        organizationId,
        ...(upTo ? { occurredAt: { lte: upTo } } : {}),
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });
  }
}
