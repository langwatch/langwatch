import { bindIdentifiers } from "@langwatch/clickhouse";
import { z } from "zod";
import type {
  messageSnapshotDataSchema,
  textMessageEndDataSchema,
} from "./schema";
import { simulationRunMessagesTable } from "./table";

/**
 * A run's messages are item rows, written by a map projection and read back by
 * the query below (ADR-103). A handler produces the domain record; the columns
 * the store owns are stamped by the derived append mapping in `index.ts`.
 */
export const simulationMessageRecordSchema = z.object({
  scenarioRunId: z.string(),
  messageId: z.string(),
  /** The producer's own numbering. A snapshot numbers by position because the
   * snapshot IS the conversation in order; a streamed message carries the same
   * number. Neither invents one, so the two never disagree for one message. */
  messageIndex: z.number().int().nonnegative(),
  role: z.string(),
  content: z.string(),
  traceId: z.string(),
  rest: z.string(),
});
export type SimulationMessageRecord = z.infer<
  typeof simulationMessageRecordSchema
>;

/**
 * An upstream SDK that ships inline binary media (voice runs persisting base64
 * PCM16 audio) must not be able to write a 90+ MB row.
 */
const MAX_MESSAGE_FIELD_BYTES = 64 * 1024;

function capOversizedString(value: string): string {
  if (value.length * 3 <= MAX_MESSAGE_FIELD_BYTES) return value;
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength <= MAX_MESSAGE_FIELD_BYTES) return value;
  return `[truncated: ${byteLength} bytes (cap ${MAX_MESSAGE_FIELD_BYTES}); likely inline media that was not externalised to stored-objects]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function restJson(fields: Record<string, unknown>): string {
  const { id: _id, role: _role, content, trace_id: _traceId, ...rest } = fields;
  const out: Record<string, unknown> = { ...rest };
  if (Array.isArray(content)) out.content = content;
  return Object.keys(out).length > 0 ? JSON.stringify(out) : "";
}

function messageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return JSON.stringify(content);
  return "";
}

/** A snapshot message with no id of its own is keyed by its position instead. */
function snapshotMessageId(id: string, index: number): string {
  return id === "" ? `#${index}` : id;
}

export function mapMessageSnapshot(
  data: z.infer<typeof messageSnapshotDataSchema>,
): SimulationMessageRecord[] {
  return data.messages.map((message, index) => {
    const record = isRecord(message) ? message : {};
    return {
      scenarioRunId: data.scenarioRunId,
      messageId: snapshotMessageId(
        typeof record.id === "string" ? record.id : "",
        index,
      ),
      messageIndex: index,
      role: typeof record.role === "string" ? record.role : "",
      content: capOversizedString(messageContent(record.content)),
      traceId: typeof record.trace_id === "string" ? record.trace_id : "",
      rest: capOversizedString(restJson(record)),
    };
  });
}

/**
 * `textMessageStart` deliberately writes no row: it carries no content, so its
 * row could only ever be superseded, and a redelivered start landing after the
 * end would blank a message that was already complete.
 */
export function mapTextMessageEnd(
  data: z.infer<typeof textMessageEndDataSchema>,
): SimulationMessageRecord {
  return {
    scenarioRunId: data.scenarioRunId,
    messageId: data.messageId,
    messageIndex: data.messageIndex,
    role: data.role,
    content: capOversizedString(data.content),
    traceId: data.traceId ?? "",
    rest: capOversizedString(
      restJson((data.message ?? {}) as Record<string, unknown>),
    ),
  };
}

export interface SimulationRunMessage {
  readonly id: string;
  readonly index: number;
  readonly role: string;
  readonly content: string;
  readonly traceId: string;
  readonly rest: string;
}

/**
 * One row per logical message, latest version only. The dedup subquery groups
 * by the table's own engine key; grouping wider would return one row per
 * unmerged version of the same message.
 */
export function buildRunMessagesQuery(args: {
  readonly tenantId: string;
  readonly scenarioRunId: string;
}): { readonly sql: string; readonly params: Record<string, unknown> } {
  const names = bindIdentifiers();
  const table = names.of(simulationRunMessagesTable.name);
  const tenant = names.of("TenantId");
  const run = names.of("ScenarioRunId");
  const updatedAt = names.of("UpdatedAt");
  const dedupKey = names.list(simulationRunMessagesTable.sortKey);
  const scope = `WHERE ${tenant} = {tenantId:String} AND ${run} = {scenarioRunId:String}`;

  const sql =
    `SELECT ${names.list(RESULT_COLUMNS)} ` +
    `FROM ${table} ` +
    `${scope} ` +
    `AND (${dedupKey}, ${updatedAt}) IN (\n` +
    `SELECT ${dedupKey}, max(${updatedAt}) FROM ${table} ${scope} ` +
    `GROUP BY ${dedupKey}\n) ` +
    `ORDER BY ${names.of("MessageIndex")}, ${names.of("MessageId")}`;

  return {
    sql,
    params: {
      ...names.params,
      tenantId: args.tenantId,
      scenarioRunId: args.scenarioRunId,
    },
  };
}

/** Positional column order {@link buildRunMessagesQuery}'s `SELECT` emits. */
const RESULT_COLUMNS = [
  "MessageId",
  "MessageIndex",
  "Role",
  "Content",
  "TraceId",
  "Rest",
] as const;

export function decodeRunMessageRows(
  rows: readonly unknown[][],
): SimulationRunMessage[] {
  return rows.map((row) => ({
    id: String(row[0] ?? ""),
    index: Number(row[1] ?? 0),
    role: String(row[2] ?? ""),
    content: String(row[3] ?? ""),
    traceId: String(row[4] ?? ""),
    rest: String(row[5] ?? ""),
  }));
}
