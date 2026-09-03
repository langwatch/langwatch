import type { AppendStore, ProjectionStoreContext } from "@langwatch/eventing";
import type { LangyMessageProjectionRecord } from "@langwatch/langy-contract";
import type { Prisma } from "@langwatch/prisma-client/generated";
import type { LangyDatabase } from "./langy-database.port";

type Row = Prisma.LangyMessageProjectionGetPayload<object>;

/** Append-only Postgres adapter for operational message rows. */
export class PrismaLangyMessageProjectionRepository implements AppendStore<LangyMessageProjectionRecord> {
  constructor(private readonly prisma: LangyDatabase) {}

  static create(database: LangyDatabase): PrismaLangyMessageProjectionRepository {
    return new PrismaLangyMessageProjectionRepository(database);
  }

  async append(
    record: LangyMessageProjectionRecord,
    context: ProjectionStoreContext,
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
