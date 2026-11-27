// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { blockedSeatChangeAttemptSchema } from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { Temporal, toDate } from "@langwatch/time";

import {
  BlockedSeatChangeRepository,
  type BlockedSeatChange,
} from "../blocked-seat-change.repository.ts";

const logger = createLogger("langwatch:billing:blocked-seat-change");

type BlockedSeatChangeDatabase = Pick<PrismaClient, "blockedSeatChange">;

/** The refused seat changes over their own table. */
export class PrismaBlockedSeatChangeRepository extends BlockedSeatChangeRepository {
  private constructor(private readonly prisma: BlockedSeatChangeDatabase) {
    super();
  }

  static create(prisma: BlockedSeatChangeDatabase): PrismaBlockedSeatChangeRepository {
    return new PrismaBlockedSeatChangeRepository(prisma);
  }

  async record(input: Parameters<BlockedSeatChangeRepository["record"]>[0]): Promise<void> {
    await this.prisma.blockedSeatChange.create({ data: input });
  }

  async findWaiting(): Promise<BlockedSeatChange[]> {
    return this.waiting({ notifiedAt: null });
  }

  async findWaitingFor(
    input: Parameters<BlockedSeatChangeRepository["findWaitingFor"]>[0],
  ): Promise<BlockedSeatChange[]> {
    return this.waiting({
      organizationId: input.organizationId,
      userId: input.userId,
      notifiedAt: null,
    });
  }

  private async waiting(where: {
    organizationId?: string;
    userId?: string;
    notifiedAt: null;
  }): Promise<BlockedSeatChange[]> {
    const rows = await this.prisma.blockedSeatChange.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });
    return rows.flatMap((row) => {
      const attempt = blockedSeatChangeAttemptSchema.safeParse(row.attempt);
      if (!attempt.success) {
        logger.warn({ id: row.id }, "Refused seat change with an unreadable attempt; skipped");
        return [];
      }
      return [
        {
          id: row.id,
          organizationId: row.organizationId,
          userId: row.userId,
          attempt: attempt.data,
          seats: row.seats,
          createdAt: Temporal.Instant.fromEpochMilliseconds(row.createdAt.getTime()),
        },
      ];
    });
  }

  async markNotified(
    input: Parameters<BlockedSeatChangeRepository["markNotified"]>[0],
  ): Promise<void> {
    await this.prisma.blockedSeatChange.updateMany({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        createdAt: { lte: toDate(input.createdUpTo) },
        notifiedAt: null,
      },
      data: { notifiedAt: toDate(input.at) },
    });
  }
}
