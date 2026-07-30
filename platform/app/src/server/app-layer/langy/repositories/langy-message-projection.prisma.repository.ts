import type { LangyMessageProjectionRecord } from "@langwatch/langy";
import type { Prisma } from "@prisma/client";
import type {
  LegacyAppendStore,
  LegacyProjectionStoreContext,
} from "~/server/app-layer/_shared/legacyProjectionStore.types";

type Row = Prisma.LangyMessageProjectionGetPayload<object>;

type MessageProjectionPrismaClient = {
  langyMessageProjection: {
    upsert(args: Prisma.LangyMessageProjectionUpsertArgs): Promise<Row>;
  };
};

/** Append-only Postgres adapter for operational message rows. */
export class PrismaLangyMessageProjectionRepository
  implements LegacyAppendStore<LangyMessageProjectionRecord>
{
  constructor(private readonly prisma: MessageProjectionPrismaClient) {}

  async append(
    record: LangyMessageProjectionRecord,
    context: LegacyProjectionStoreContext,
  ): Promise<void> {
    const projectId = String(context.tenantId);
    const identity = {
      projectId,
      ConversationId: record.ConversationId,
      MessageId: record.MessageId,
    };
    const data = {
      projectId,
      ...record,
    } satisfies Prisma.LangyMessageProjectionUncheckedCreateInput;
    await this.prisma.langyMessageProjection.upsert({
      where: { projectId, projectId_ConversationId_MessageId: identity },
      create: data,
      update: record,
    });
  }
}
