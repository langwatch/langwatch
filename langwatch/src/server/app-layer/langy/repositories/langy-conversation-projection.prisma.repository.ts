import type { Prisma } from "@prisma/client";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";
import type { LangyConversationStateData } from "@langwatch/langy";

type Row = Prisma.LangyConversationProjectionGetPayload<object>;

type ConversationProjectionPrismaClient = {
  langyConversationProjection: {
    findUnique(
      args: Prisma.LangyConversationProjectionFindUniqueArgs,
    ): Promise<Row | null>;
    upsert(args: Prisma.LangyConversationProjectionUpsertArgs): Promise<Row>;
  };
};

function fromRow(row: Row): StoredProjection<LangyConversationStateData> {
  const {
    id: _id,
    projectId: _projectId,
    OccurredAt,
    AcceptedAt,
    LastEventId,
    ProjectionVersion,
    ...state
  } = row;
  return {
    state: { ...state, LastEventOccurredAt: OccurredAt },
    cursor: { acceptedAt: AcceptedAt, eventId: LastEventId },
    occurredAt: OccurredAt,
    createdAt: state.CreatedAt,
    updatedAt: state.UpdatedAt,
    version: ProjectionVersion,
  };
}

/** Postgres row I/O for the type-aware conversation projection. */
export class PrismaLangyConversationProjectionRepository implements StateProjectionStore<LangyConversationStateData> {
  constructor(private readonly prisma: ConversationProjectionPrismaClient) {}

  async load(
    ConversationId: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjection<LangyConversationStateData> | null> {
    const projectId = String(context.tenantId);
    const row = await this.prisma.langyConversationProjection.findUnique({
      where: {
        // Keep the tenant predicate explicit for the Prisma tenancy guard;
        // the compound unique remains the database lookup key.
        projectId,
        projectId_ConversationId: { projectId, ConversationId },
      },
    });
    return row ? fromRow(row) : null;
  }

  async store(
    projection: StoredProjection<LangyConversationStateData>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const projectId = String(context.tenantId);
    const ConversationId = context.aggregateId;
    const { LastEventOccurredAt: _checkpoint, ...state } = projection.state;
    const data = {
      ...state,
      ConversationId,
      CreatedAt: projection.createdAt,
      UpdatedAt: projection.updatedAt,
      OccurredAt: projection.occurredAt,
      AcceptedAt: projection.cursor.acceptedAt,
      LastEventId: projection.cursor.eventId,
      ProjectionVersion: projection.version,
    } satisfies Omit<
      Prisma.LangyConversationProjectionUncheckedCreateInput,
      "id" | "projectId"
    >;

    await this.prisma.langyConversationProjection.upsert({
      where: {
        projectId,
        projectId_ConversationId: { projectId, ConversationId },
      },
      create: { projectId, ...data },
      update: data,
    });
  }
}
