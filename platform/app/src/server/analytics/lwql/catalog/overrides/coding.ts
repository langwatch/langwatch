/**
 * Overrides and the one hand-written joined view for the coding-agent
 * views that are not `coding_agent_sessions` /
 * `coding_agent_session_events` (#8085 / #8116 Part B, step 5).
 *
 * - `coding_agent_trace_sessions`: the trace<->session correlation table.
 *   Derived defaults are safe as-is; the only refinement is naming the join
 *   keys another view can match on.
 * - `stored_objects`: keyed by the physical column `project_id`, not the
 *   catalog's default `TenantId` — the `tenantColumn` override (unblocked by
 *   #8085/#8116 step 4's per-table row-policy column) is what lets the
 *   generic row policy machinery police it correctly. Exposed as `objects`
 *   with the physical column surfaced under the catalog's usual `TenantId`
 *   name via an alias, so a caller never has to know the storage detail.
 * - `coding_tool_results`: NOT derived — a view spanning two physical
 *   tables needs the join extension (`LangWatchQLViewJoin`), which
 *   `defineCatalogTable` does not build. Hand-written and exported for the
 *   merge step (#8085/#8116 step 6) to add to `LWQL_VIEW_CATALOG` alongside
 *   the derived entries; not registered here.
 */

import { LWQL_SOURCE_ALIAS } from "../../provisioning/sourceAlias";
import type { DatasetOverride } from "../defineDatasetFromTable";
import type { LangWatchQLViewDefinition } from "../types";

export const CODING_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  coding_agent_trace_sessions: {
    // The default name is the physical table name, which collides with it (the
    // view lives in the same ClickHouse database as the fact table on
    // self-hosted — see `selfProvisioning.ts`'s same-database requirement).
    name: "coding_trace_sessions",
    description:
      "Correlates a trace to the coding-agent session it belongs to.",
    grain: "one row per (TenantId, TraceId)",
    timeColumn: "OccurredAt",
    joinKeys: ["TraceId", "SessionId"],
    // `ReplacingMergeTree(UpdatedAt)` (migration 00051): a re-contribution of the
    // same trace writes a newer version, collapsed on `UpdatedAt`.
    dedup: { versionColumn: "UpdatedAt" },
  },
  stored_objects: {
    name: "objects",
    description: "Stored file objects: what was captured, its size and hash.",
    grain: "one row per id",
    timeColumn: "created_at",
    tenantColumn: "project_id",
    // `ReplacingMergeTree(inserted_at)` (migration 00023).
    dedup: { versionColumn: "inserted_at" },
    aliases: {
      TenantId: "project_id",
    },
    descriptions: {
      TenantId: "Project the object belongs to.",
    },
  },
};

/**
 * A tool call's printed output: `stored_spans` (one row per `claude_code.tool`
 * span) LEFT-joined to `log_records` (the request body OTel captured for that
 * trace), matched by tenant and trace.
 *
 * `LEFT`, not `INNER`: a span this ships with no captured request body — the
 * export never ran, or the log has since expired under its own TTL — is a
 * normal case (langwatch-saas#811), not an absent row. Every `claude_code.tool`
 * span keeps its row with `OutputText = ''` rather than disappearing from the
 * view, which is what an `INNER` join would do.
 *
 * `OutputText` reads the joined side's `AttributesJson.body` (itself a
 * JSON-encoded string, per the OTel wire shape — hence the nested
 * `JSONExtractString` before `JSONExtractArrayRaw`), finds the first
 * `messages[].content[]` block whose `type` is `tool_result` and whose
 * `tool_use_id` matches this span's own, and reads its text — as a plain
 * string when `content` is one, or the concatenation of every `type: "text"`
 * block's `text` when `content` is itself an array of blocks. All of this is
 * one expression per the array-search constraint (#8085/#8116 step 5): no
 * `ARRAY JOIN`, so a row of `coding_tool_results` is always exactly one row of
 * `stored_spans`, never multiplied by however many blocks a message carries.
 */
export const CODING_TOOL_RESULTS: LangWatchQLViewDefinition = {
  name: "coding_tool_results",
  sourceTable: "stored_spans",
  description:
    "One row per coding-agent tool call, with the text it printed back to " +
    "the agent.",
  gates: [],
  grain: "one row per (TenantId, TraceId, SpanId), latest version only",
  grainColumns: ["TenantId", "TraceId", "SpanId"],
  joinKeys: ["TenantId", "TraceId", "SpanId", "SessionId", "ToolUseId"],
  // The span's own start, which `stored_spans` partitions by — filter on it to
  // prune partitions, like `spans.StartTime`. `CapturedAt` (the joined body's
  // write time) is not a partition column of either source.
  timeColumn: "StartTime",
  freshness: "seconds behind ingestion",
  where: `${LWQL_SOURCE_ALIAS}.\`SpanName\` = 'claude_code.tool'`,
  whereSourceColumns: ["SpanName"],
  join: {
    table: "log_records",
    alias: "l",
    kind: "LEFT",
    on:
      `${LWQL_SOURCE_ALIAS}.\`TenantId\` = l.\`TenantId\` AND ` +
      `${LWQL_SOURCE_ALIAS}.\`TraceId\` = l.\`CorrelationTraceId\` AND ` +
      `l.\`EventName\` = 'api_request_body'`,
    onSourceColumns: {
      primary: ["TenantId", "TraceId"],
      joined: ["TenantId", "CorrelationTraceId", "EventName"],
    },
    sourceColumns: [
      "TenantId",
      "CorrelationTraceId",
      "EventName",
      "ProviderSessionId",
      "AttributesJson",
      "TimeUnixMs",
    ],
  },
  dedup: {
    keyColumns: ["TenantId", "TraceId", "SpanId"],
    // Mirrors `spans` (lwqlViews.ts): `stored_spans` is
    // `ReplacingMergeTree(StartTime)`, so `StartTime` — not a bookkeeping
    // `UpdatedAt` — is what the engine itself collapses on.
    versionColumn: "StartTime",
  },
  columns: [
    {
      name: "TenantId",
      type: "String",
      description: "Project the tool call belongs to.",
      gates: [],
      sourceColumns: ["TenantId"],
    },
    {
      name: "TraceId",
      type: "String",
      description: "Trace the tool call's span belongs to.",
      gates: [],
      sourceColumns: ["TraceId"],
    },
    {
      name: "SpanId",
      type: "String",
      description: "The tool-call span's own id.",
      gates: [],
      sourceColumns: ["SpanId"],
    },
    {
      name: "StartTime",
      type: "DateTime64(3)",
      description:
        "When the tool-call span started. Filter on this to prune partitions.",
      gates: [],
      sourceColumns: ["StartTime"],
    },
    {
      name: "SessionId",
      type: "String",
      description: "Coding-agent session the captured request belongs to.",
      gates: [],
      sourceColumns: [],
      joinedSourceColumns: ["ProviderSessionId"],
      expression: (_source, joined) => joined!("ProviderSessionId"),
    },
    {
      name: "ToolUseId",
      type: "String",
      description:
        "The tool call's id, as the agent's wire protocol assigned it.",
      gates: [],
      sourceColumns: ["SpanAttributes"],
      expression: (source) => `${source("SpanAttributes")}['tool_use_id']`,
    },
    {
      name: "ToolName",
      type: "String",
      description: "Name of the tool that was called.",
      gates: [],
      sourceColumns: ["SpanAttributes"],
      expression: (source) => `${source("SpanAttributes")}['tool_name']`,
    },
    {
      name: "Success",
      type: "Nullable(UInt8)",
      description:
        "1 when the span's status code is not the OTel error code (2), 0 " +
        "when it is, null when the span carries no status code.",
      gates: [],
      sourceColumns: ["StatusCode"],
      expression: (source) => `${source("StatusCode")} != 2`,
    },
    {
      name: "OutputText",
      type: "String",
      description:
        "What the tool call printed back to the agent. Empty when no " +
        "request body was captured for this trace.",
      gates: ["output"],
      sourceColumns: ["SpanAttributes"],
      // Its content comes from the joined request body, not from the primary
      // side's `SpanAttributes` map (which it reads only to match `tool_use_id`)
      // — so its `output` gate is justified by the join, and the primary-side
      // key it reads is a filter, not the content.
      joinedSourceColumns: ["AttributesJson"],
      expression: (source, joined) => {
        const toolUseId = `${source("SpanAttributes")}['tool_use_id']`;
        const body = `JSONExtractString(${joined!("AttributesJson")}, 'body')`;
        const messages = `JSONExtractArrayRaw(${body}, 'messages')`;
        const blocks =
          `arrayFlatten(arrayMap(msg -> ` +
          `JSONExtractArrayRaw(JSONExtractRaw(msg, 'content')), ${messages}))`;
        const matching =
          `arrayFilter(b -> JSONExtractString(b, 'type') = 'tool_result' ` +
          `AND JSONExtractString(b, 'tool_use_id') = ${toolUseId}, ${blocks})`;
        const first = `arrayFirst(x -> 1, ${matching})`;
        const textBlocks =
          `arrayFilter(x -> JSONExtractString(x, 'type') = 'text', ` +
          `JSONExtractArrayRaw(JSONExtractRaw(${first}, 'content')))`;
        const concatenatedText =
          `arrayStringConcat(arrayMap(x -> JSONExtractString(x, 'text'), ` +
          `${textBlocks}), '')`;
        return (
          `if(${first} = '', '', ` +
          `if(JSONType(${first}, 'content') = 'String', ` +
          `JSONExtractString(${first}, 'content'), ${concatenatedText}))`
        );
      },
    },
    {
      name: "CapturedAt",
      type: "DateTime64(3)",
      description: "When the captured request body was written.",
      gates: [],
      sourceColumns: [],
      joinedSourceColumns: ["TimeUnixMs"],
      expression: (_source, joined) => joined!("TimeUnixMs"),
    },
  ],
};
