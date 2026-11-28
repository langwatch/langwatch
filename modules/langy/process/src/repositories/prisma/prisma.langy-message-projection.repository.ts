import type { AppendStore, ProjectionStoreContext } from "@langwatch/eventing";
import type { LangyMessageProjectionRecord } from "@langwatch/langy-contract";
import type { Prisma } from "@langwatch/prisma-client/generated";

import { stripNulCharacters } from "../../rules/langy-projection-nul.rules.ts";
import type { LangyDatabase } from "./langy-database.mapper.ts";

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
    // Message parts are model and user content: Postgres refuses a NUL in jsonb.
    const clean = stripNulCharacters(record);
    const identity = {
      projectId,
      ConversationId: clean.ConversationId,
      MessageId: clean.MessageId,
    };
    const data = {
      projectId,
      ...clean,
    } satisfies Prisma.LangyMessageProjectionUncheckedCreateInput;
    await this.prisma.langyMessageProjection.upsert({
      where: { projectId, projectId_ConversationId_MessageId: identity },
      create: data,
      update: clean,
    });
  }
}
