import type {
  Projection,
  ProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../";

/**
 * Store for the per-turn fold document (langyConversationTurn). Keyed by the
 * composite `${conversationId}:${turnId}` (the fold's custom key), not the raw
 * conversationId — so one conversation has many turn documents.
 */
export interface LangyConversationTurnStateRepository<
  ProjectionType extends Projection = Projection,
> extends ProjectionStore<ProjectionType> {
  getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null>;

  storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void>;
}
