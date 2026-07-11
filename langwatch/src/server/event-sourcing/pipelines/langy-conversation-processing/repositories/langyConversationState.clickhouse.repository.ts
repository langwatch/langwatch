import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import {
  classifyClickHouseError,
  SecurityError,
  StoreError,
  ValidationError,
} from "~/server/event-sourcing/services/errorHandling";
import { createLogger } from "../../../../../utils/logger";
import type {
  Projection,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../";
import { createTenantId, EventUtils } from "../../../";
import {
  LANGY_TITLE_SOURCE,
  type LangyTitleSource,
} from "../schemas/constants";
import type {
  LangyConversationState,
  LangyConversationStateData,
} from "../projections/langyConversationState.foldProjection";
import type { LangyConversationStateRepository } from "./langyConversationState.repository";

/** Narrow a raw ClickHouse string to the title-source union (fallback: derived). */
function toTitleSource(raw: string | null | undefined): LangyTitleSource {
  return raw === LANGY_TITLE_SOURCE.AUTO || raw === LANGY_TITLE_SOURCE.USER
    ? raw
    : LANGY_TITLE_SOURCE.DERIVED;
}

const TABLE_NAME = "langy_conversations" as const;

const logger = createLogger(
  "langwatch:langy-conversation-processing:conversation-state-repository",
);

/** Row shape read back from ClickHouse (timestamps projected as ms numbers). */
interface ClickHouseLangyConversationRecord {
  ProjectionId: string;
  TenantId: string;
  ConversationId: string;
  Version: string;
  UserId: string;
  Title: string | null;
  TitleSource: string | null;
  Status: string;
  IsShared: boolean;
  SharedAt: number | null;
  SharedById: string | null;
  MessageCount: number;
  LastActivityAt: number | null;
  CurrentTurnId: string | null;
  LastError: string | null;
  PendingHandoffToken: string | null;
  PendingHandoffTurnId: string | null;
  CreatedAt: number;
  UpdatedAt: number;
  ArchivedAt: number | null;
  LastEventOccurredAt: number;
}

/** Row shape written to ClickHouse (Date objects for the datetime columns). */
interface ClickHouseLangyConversationWriteRecord {
  ProjectionId: string;
  TenantId: string;
  ConversationId: string;
  Version: string;
  UserId: string;
  Title: string | null;
  TitleSource: string;
  Status: string;
  IsShared: boolean;
  SharedAt: Date | null;
  SharedById: string | null;
  MessageCount: number;
  LastActivityAt: Date | null;
  CurrentTurnId: string | null;
  LastError: string | null;
  PendingHandoffToken: string | null;
  PendingHandoffTurnId: string | null;
  CreatedAt: Date;
  UpdatedAt: Date;
  ArchivedAt: Date | null;
  LastEventOccurredAt: Date;
}

export class LangyConversationStateRepositoryClickHouse<
  ProjectionType extends Projection = Projection,
> implements LangyConversationStateRepository<ProjectionType>
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  private mapRecordToProjectionData(
    record: ClickHouseLangyConversationRecord,
  ): LangyConversationStateData {
    return {
      ConversationId: record.ConversationId,
      UserId: record.UserId,
      Title: record.Title,
      TitleSource: toTitleSource(record.TitleSource),
      Status: record.Status,
      IsShared: Boolean(record.IsShared),
      SharedAt: record.SharedAt === null ? null : Number(record.SharedAt),
      SharedById: record.SharedById,
      MessageCount: Number(record.MessageCount ?? 0),
      LastActivityAt:
        record.LastActivityAt === null ? null : Number(record.LastActivityAt),
      CurrentTurnId: record.CurrentTurnId,
      LastError: record.LastError,
      PendingHandoffToken: record.PendingHandoffToken,
      PendingHandoffTurnId: record.PendingHandoffTurnId,
      ArchivedAt: record.ArchivedAt === null ? null : Number(record.ArchivedAt),
      CreatedAt: Number(record.CreatedAt),
      UpdatedAt: Number(record.UpdatedAt),
      LastEventOccurredAt: Number(record.LastEventOccurredAt ?? 0),
    };
  }

  private mapProjectionDataToWriteRecord(
    data: LangyConversationStateData,
    tenantId: string,
    projectionId: string,
    projectionVersion: string,
    conversationId: string,
  ): ClickHouseLangyConversationWriteRecord {
    return {
      ProjectionId: projectionId,
      TenantId: tenantId,
      ConversationId: conversationId || data.ConversationId,
      Version: projectionVersion,
      UserId: data.UserId,
      Title: data.Title,
      TitleSource: data.TitleSource,
      Status: data.Status,
      IsShared: data.IsShared,
      SharedAt: data.SharedAt != null ? new Date(data.SharedAt) : null,
      SharedById: data.SharedById,
      MessageCount: data.MessageCount,
      LastActivityAt:
        data.LastActivityAt != null ? new Date(data.LastActivityAt) : null,
      CurrentTurnId: data.CurrentTurnId,
      LastError: data.LastError,
      PendingHandoffToken: data.PendingHandoffToken,
      PendingHandoffTurnId: data.PendingHandoffTurnId,
      CreatedAt: data.CreatedAt != null ? new Date(data.CreatedAt) : new Date(),
      UpdatedAt: new Date(data.UpdatedAt),
      ArchivedAt: data.ArchivedAt != null ? new Date(data.ArchivedAt) : null,
      LastEventOccurredAt: data.LastEventOccurredAt
        ? new Date(data.LastEventOccurredAt)
        : new Date(0),
    };
  }

  async getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null> {
    EventUtils.validateTenantId(
      context,
      "LangyConversationStateRepositoryClickHouse.getProjection",
    );

    const conversationId = String(aggregateId);

    try {
      const client = await this.resolveClient(context.tenantId);
      // Latest-version read over the ReplacingMergeTree(UpdatedAt) for a single
      // conversation. TenantId is the first predicate. The inner scalar
      // subquery finds the newest UpdatedAt reading only light sort-key
      // columns; the outer equality is PREWHERE-able so heavy columns are
      // materialised for the single surviving row. No FINAL.
      const result = await client.query({
        query: `
          SELECT
            t.ProjectionId AS ProjectionId, t.TenantId AS TenantId,
            t.ConversationId AS ConversationId, t.Version AS Version,
            t.UserId AS UserId, t.Title AS Title,
            t.TitleSource AS TitleSource, t.Status AS Status,
            t.IsShared AS IsShared,
            if(t.SharedAt IS NOT NULL, toUnixTimestamp64Milli(t.SharedAt), NULL) AS SharedAt,
            t.SharedById AS SharedById,
            t.MessageCount AS MessageCount,
            if(t.LastActivityAt IS NOT NULL, toUnixTimestamp64Milli(t.LastActivityAt), NULL) AS LastActivityAt,
            t.CurrentTurnId AS CurrentTurnId, t.LastError AS LastError,
            t.PendingHandoffToken AS PendingHandoffToken,
            t.PendingHandoffTurnId AS PendingHandoffTurnId,
            toUnixTimestamp64Milli(t.CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(t.UpdatedAt) AS UpdatedAt,
            if(t.ArchivedAt IS NOT NULL, toUnixTimestamp64Milli(t.ArchivedAt), NULL) AS ArchivedAt,
            toUnixTimestamp64Milli(t.LastEventOccurredAt) AS LastEventOccurredAt
          FROM ${TABLE_NAME} AS t
          WHERE t.TenantId = {tenantId:String}
            AND t.ConversationId = {conversationId:String}
            AND t.UpdatedAt = (
              SELECT max(s.UpdatedAt)
              FROM ${TABLE_NAME} AS s
              WHERE s.TenantId = {tenantId:String}
                AND s.ConversationId = {conversationId:String}
            )
          LIMIT 1
        `,
        query_params: { tenantId: context.tenantId, conversationId },
        format: "JSONEachRow",
      });

      const rows = await result.json<ClickHouseLangyConversationRecord>();
      const row = rows[0];
      if (!row) return null;

      const projection: LangyConversationState = {
        id: row.ProjectionId,
        aggregateId: conversationId,
        tenantId: createTenantId(context.tenantId),
        version: row.Version,
        data: this.mapRecordToProjectionData(row),
      };

      return projection as ProjectionType;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { conversationId, tenantId: context.tenantId, error: errorMessage },
        "Failed to get langy conversation projection from ClickHouse",
      );
      throw new StoreError(
        "getProjection",
        "LangyConversationStateRepositoryClickHouse",
        `Failed to get projection for conversation ${conversationId}: ${errorMessage}`,
        classifyClickHouseError(error),
        { conversationId },
        error,
      );
    }
  }

  async storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    EventUtils.validateTenantId(
      context,
      "LangyConversationStateRepositoryClickHouse.storeProjection",
    );

    if (!EventUtils.isValidProjection(projection)) {
      throw new ValidationError(
        "Invalid projection: projection must have id, aggregateId, tenantId, version, and data",
        "projection",
        projection,
      );
    }

    if (projection.tenantId !== context.tenantId) {
      throw new SecurityError(
        "storeProjection",
        `Projection has tenantId '${projection.tenantId}' that does not match context tenantId '${context.tenantId}'`,
        projection.tenantId,
        { contextTenantId: context.tenantId },
      );
    }

    try {
      const conversationId = String(projection.aggregateId);
      const record = this.mapProjectionDataToWriteRecord(
        projection.data as LangyConversationStateData,
        String(context.tenantId),
        projection.id,
        projection.version,
        conversationId,
      );

      const client = await this.resolveClient(context.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [record],
        format: "JSONEachRow",
        clickhouse_settings: {
          async_insert: 1,
          wait_for_async_insert: 0,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        {
          tenantId: context.tenantId,
          conversationId: String(projection.aggregateId),
          projectionId: projection.id,
          error: errorMessage,
        },
        "Failed to store langy conversation projection in ClickHouse",
      );
      throw new StoreError(
        "storeProjection",
        "LangyConversationStateRepositoryClickHouse",
        `Failed to store projection ${projection.id} for conversation ${projection.aggregateId}: ${errorMessage}`,
        classifyClickHouseError(error),
        {
          projectionId: projection.id,
          conversationId: String(projection.aggregateId),
        },
        error,
      );
    }
  }
}
