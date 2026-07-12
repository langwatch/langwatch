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
  LANGY_CONVERSATION_TURN_STATUS,
  type LangyConversationTurnStatus,
} from "../schemas/constants";
import type { LangyMessagePart } from "../schemas/shared";
import {
  type LangyConversationTurn,
  type LangyConversationTurnData,
  type LangyTurnToolCall,
  parseConversationTurnKey,
} from "../projections/langyConversationTurn.foldProjection";
import type { LangyConversationTurnStateRepository } from "./langyConversationTurnState.repository";

const TABLE_NAME = "langy_conversation_turns" as const;

const logger = createLogger(
  "langwatch:langy-conversation-processing:conversation-turn-repository",
);

const TURN_STATUSES = new Set<string>(
  Object.values(LANGY_CONVERSATION_TURN_STATUS),
);

/** Narrow a raw ClickHouse status string to the union (fallback: pending). */
function toTurnStatus(raw: string | null | undefined): LangyConversationTurnStatus {
  return raw && TURN_STATUSES.has(raw)
    ? (raw as LangyConversationTurnStatus)
    : LANGY_CONVERSATION_TURN_STATUS.PENDING;
}

/** Parse a JSON array column, tolerating null/garbage (fold docs are trusted). */
function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** Row shape read back from ClickHouse (timestamps projected as ms numbers). */
interface ClickHouseLangyTurnRecord {
  ProjectionId: string;
  TenantId: string;
  ConversationId: string;
  TurnId: string;
  Version: string;
  Status: string;
  QuestionParts: string;
  AnswerParts: string;
  ToolCalls: string;
  Error: string | null;
  StartedAt: number | null;
  EndedAt: number | null;
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
}

/** Row shape written to ClickHouse (Date objects for datetime columns). */
interface ClickHouseLangyTurnWriteRecord {
  ProjectionId: string;
  TenantId: string;
  ConversationId: string;
  TurnId: string;
  Version: string;
  Status: string;
  QuestionParts: string;
  AnswerParts: string;
  ToolCalls: string;
  Error: string | null;
  StartedAt: Date | null;
  EndedAt: Date | null;
  CreatedAt: Date;
  UpdatedAt: Date;
  LastEventOccurredAt: Date;
}

export class LangyConversationTurnStateRepositoryClickHouse<
  ProjectionType extends Projection = Projection,
> implements LangyConversationTurnStateRepository<ProjectionType>
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  private mapRecordToProjectionData(
    record: ClickHouseLangyTurnRecord,
  ): LangyConversationTurnData {
    return {
      ConversationId: record.ConversationId,
      TurnId: record.TurnId,
      Status: toTurnStatus(record.Status),
      QuestionParts: parseJsonArray<LangyMessagePart>(record.QuestionParts),
      AnswerParts: parseJsonArray<LangyMessagePart>(record.AnswerParts),
      ToolCalls: parseJsonArray<LangyTurnToolCall>(record.ToolCalls),
      Error: record.Error,
      StartedAt: record.StartedAt === null ? null : Number(record.StartedAt),
      EndedAt: record.EndedAt === null ? null : Number(record.EndedAt),
      CreatedAt: Number(record.CreatedAt),
      UpdatedAt: Number(record.UpdatedAt),
      LastEventOccurredAt: Number(record.LastEventOccurredAt ?? 0),
    };
  }

  private mapProjectionDataToWriteRecord(
    data: LangyConversationTurnData,
    tenantId: string,
    projectionId: string,
    projectionVersion: string,
  ): ClickHouseLangyTurnWriteRecord {
    return {
      ProjectionId: projectionId,
      TenantId: tenantId,
      ConversationId: data.ConversationId,
      TurnId: data.TurnId,
      Version: projectionVersion,
      Status: data.Status,
      QuestionParts: JSON.stringify(data.QuestionParts ?? []),
      AnswerParts: JSON.stringify(data.AnswerParts ?? []),
      ToolCalls: JSON.stringify(data.ToolCalls ?? []),
      Error: data.Error,
      StartedAt: data.StartedAt != null ? new Date(data.StartedAt) : null,
      EndedAt: data.EndedAt != null ? new Date(data.EndedAt) : null,
      CreatedAt: data.CreatedAt != null ? new Date(data.CreatedAt) : new Date(),
      UpdatedAt: new Date(data.UpdatedAt),
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
      "LangyConversationTurnStateRepositoryClickHouse.getProjection",
    );

    const { conversationId, turnId } = parseConversationTurnKey(
      String(aggregateId),
    );

    try {
      const client = await this.resolveClient(context.tenantId);
      // Latest-version read over the ReplacingMergeTree(UpdatedAt) for a single
      // turn. TenantId first, then the (ConversationId, TurnId) sort-key prefix.
      const result = await client.query({
        query: `
          SELECT
            t.ProjectionId AS ProjectionId, t.TenantId AS TenantId,
            t.ConversationId AS ConversationId, t.TurnId AS TurnId,
            t.Version AS Version, t.Status AS Status,
            t.QuestionParts AS QuestionParts, t.AnswerParts AS AnswerParts,
            t.ToolCalls AS ToolCalls, t.Error AS Error,
            if(t.StartedAt IS NOT NULL, toUnixTimestamp64Milli(t.StartedAt), NULL) AS StartedAt,
            if(t.EndedAt IS NOT NULL, toUnixTimestamp64Milli(t.EndedAt), NULL) AS EndedAt,
            toUnixTimestamp64Milli(t.CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(t.UpdatedAt) AS UpdatedAt,
            toUnixTimestamp64Milli(t.LastEventOccurredAt) AS LastEventOccurredAt
          FROM ${TABLE_NAME} AS t
          WHERE t.TenantId = {tenantId:String}
            AND t.ConversationId = {conversationId:String}
            AND t.TurnId = {turnId:String}
            AND t.UpdatedAt = (
              SELECT max(s.UpdatedAt)
              FROM ${TABLE_NAME} AS s
              WHERE s.TenantId = {tenantId:String}
                AND s.ConversationId = {conversationId:String}
                AND s.TurnId = {turnId:String}
            )
          LIMIT 1
        `,
        query_params: { tenantId: context.tenantId, conversationId, turnId },
        format: "JSONEachRow",
      });

      const rows = await result.json<ClickHouseLangyTurnRecord>();
      const row = rows[0];
      if (!row) return null;

      const projection: LangyConversationTurn = {
        id: row.ProjectionId,
        aggregateId: String(aggregateId),
        tenantId: createTenantId(context.tenantId),
        version: row.Version,
        data: this.mapRecordToProjectionData(row),
      };

      return projection as unknown as ProjectionType;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { conversationId, turnId, tenantId: context.tenantId, error: errorMessage },
        "Failed to get langy conversation turn projection from ClickHouse",
      );
      throw new StoreError(
        "getProjection",
        "LangyConversationTurnStateRepositoryClickHouse",
        `Failed to get turn projection for ${conversationId}/${turnId}: ${errorMessage}`,
        classifyClickHouseError(error),
        { conversationId, turnId },
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
      "LangyConversationTurnStateRepositoryClickHouse.storeProjection",
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
      const record = this.mapProjectionDataToWriteRecord(
        projection.data as LangyConversationTurnData,
        String(context.tenantId),
        projection.id,
        projection.version,
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
          aggregateId: String(projection.aggregateId),
          projectionId: projection.id,
          error: errorMessage,
        },
        "Failed to store langy conversation turn projection in ClickHouse",
      );
      throw new StoreError(
        "storeProjection",
        "LangyConversationTurnStateRepositoryClickHouse",
        `Failed to store turn projection ${projection.id} for ${projection.aggregateId}: ${errorMessage}`,
        classifyClickHouseError(error),
        {
          projectionId: projection.id,
          aggregateId: String(projection.aggregateId),
        },
        error,
      );
    }
  }
}
