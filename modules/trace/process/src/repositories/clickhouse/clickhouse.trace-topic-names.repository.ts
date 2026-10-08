import { EventUtils, type FoldStateRead, type ProjectionStoreContext } from "@langwatch/eventing";
import { Temporal, toDate } from "@langwatch/time";
import { z } from "zod";

import { topicNameChanges } from "../../rules/trace-topic-names.rules.ts";
import {
  type TraceTopicNamesFoldState,
  TraceTopicNamesReadRepository,
  type TraceTopicNamesRepository,
} from "../trace-topic-names.repository.ts";
import type { TraceClickHouseWriteResolver } from "./clickhouse.trace-member-client.repository.ts";
import { chNumber, chString } from "./stored-span-row.mapper.ts";

const TABLE_NAME = "trace_topic_names" as const;

const topicNameRowSchema = z.looseObject({
  TopicId: chString,
  Name: chString,
  ParentId: chString.nullable(),
  IsRemoved: chNumber,
  LastEventOccurredAtMs: chNumber,
  UpdatedAtMs: chNumber,
});
const topicNameRowsSchema = z.array(topicNameRowSchema);
type TopicNameRow = z.infer<typeof topicNameRowSchema>;

function clickHouseTimestamp(epochMs: number): Date {
  return toDate(Temporal.Instant.fromEpochMilliseconds(epochMs));
}

/** Trace's folded topic names in `trace_topic_names` (00107): the fold's store and label read. */
export class ClickHouseTraceTopicNamesRepository
  extends TraceTopicNamesReadRepository
  implements TraceTopicNamesRepository
{
  static create(resolveClient: TraceClickHouseWriteResolver): ClickHouseTraceTopicNamesRepository {
    return new ClickHouseTraceTopicNamesRepository(resolveClient);
  }

  private constructor(private readonly resolveClient: TraceClickHouseWriteResolver) {
    super();
  }

  async get(
    _aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<FoldStateRead<TraceTopicNamesFoldState>> {
    const rows = await this.latestRows({ tenantId: context.tenantId });
    if (rows.length === 0) return { kind: "empty" };
    return { kind: "folded", state: stateOf(rows) };
  }

  async store(state: TraceTopicNamesFoldState, context: ProjectionStoreContext): Promise<void> {
    const tenantId = context.tenantId;
    EventUtils.validateTenantId({ tenantId }, "ClickHouseTraceTopicNamesRepository.store");
    const rows = await this.latestRows({ tenantId });
    const changes = topicNameChanges({ previous: stateOf(rows).topics, next: state.topics });
    if (changes.length === 0) return;
    // A version above every row already written, so this write wins each key it touches.
    const version = Math.max(state.LastEventOccurredAt, ...rows.map((row) => row.UpdatedAtMs + 1));
    const client = await this.resolveClient(tenantId);
    await client.insert({
      table: TABLE_NAME,
      values: changes.map(({ topic, removed }) => ({
        TenantId: tenantId,
        TopicId: topic.id,
        Name: topic.name,
        ParentId: topic.parentId,
        IsRemoved: removed ? 1 : 0,
        LastEventOccurredAt: clickHouseTimestamp(state.LastEventOccurredAt),
        UpdatedAt: clickHouseTimestamp(version),
      })),
      format: "JSONEachRow",
    });
  }

  async findNamesByIds({
    projectId,
    ids,
  }: {
    projectId: string;
    ids: string[];
  }): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.latestRows({ tenantId: projectId, topicIds: ids });
    return new Map(rows.filter((row) => row.IsRemoved === 0).map((row) => [row.TopicId, row.Name]));
  }

  private async latestRows({
    tenantId,
    topicIds,
  }: {
    tenantId: string;
    topicIds?: string[];
  }): Promise<TopicNameRow[]> {
    EventUtils.validateTenantId({ tenantId }, "ClickHouseTraceTopicNamesRepository.latestRows");
    const byId = topicIds ? "AND TopicId IN ({topicIds:Array(String)})" : "";
    const client = await this.resolveClient(tenantId);
    const result = await client.query({
      query: `
        SELECT
          TopicId,
          Name,
          ParentId,
          IsRemoved,
          toUnixTimestamp64Milli(LastEventOccurredAt) AS LastEventOccurredAtMs,
          toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAtMs
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          ${byId}
          AND (TenantId, TopicId, UpdatedAt) IN (
            SELECT TenantId, TopicId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              ${byId}
            GROUP BY TenantId, TopicId
          )
      `,
      query_params: { tenantId, ...(topicIds ? { topicIds } : {}) },
      format: "JSONEachRow",
    });
    return topicNameRowsSchema.parse(await result.json());
  }
}

function stateOf(rows: readonly TopicNameRow[]): TraceTopicNamesFoldState {
  return {
    topics: rows
      .filter((row) => row.IsRemoved === 0)
      .map((row) => ({ id: row.TopicId, name: row.Name, parentId: row.ParentId }))
      .toSorted((a, b) => a.id.localeCompare(b.id)),
    LastEventOccurredAt: Math.max(0, ...rows.map((row) => row.LastEventOccurredAtMs)),
  };
}
