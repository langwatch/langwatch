import type { Named } from "@langwatch/module";
/**
 * The shared ClickHouse server's own state, read from its system tables for ops functions
 * (ADR-202): failed statements grouped by shape, and replica, part, merge, disk and memory
 * health. Ids, counts, codes and times only; never a statement's text.
 */
import { z } from "zod";

/** Where a failed statement came from, by its `log_comment` tag; untagged ones are `other`. */
export const CLICKHOUSE_QUERY_SOURCES = [
  "lwql",
  "dashboard",
  "instant_eval",
  "trace_list",
  "facet",
  "other",
] as const;
export const clickHouseQuerySourceSchema = z.enum(CLICKHOUSE_QUERY_SOURCES);
export type ClickHouseQuerySource = z.infer<typeof clickHouseQuerySourceSchema>;

/** The most project ids one error group names. */
export const CLICKHOUSE_QUERY_ERROR_MAX_PROJECTS = 20;

const clickHouseQueryErrorsInputSchemaDefinition = z
  .object({
    /** Epoch milliseconds, inclusive. */
    sinceMs: z.number().int().nonnegative(),
    /** Epoch milliseconds, exclusive. */
    untilMs: z.number().int().nonnegative(),
    code: z.number().int().nonnegative().optional(),
    source: clickHouseQuerySourceSchema.optional(),
  })
  .strict();
export interface ClickHouseQueryErrorsInputSchema extends Named<
  typeof clickHouseQueryErrorsInputSchemaDefinition
> {}
export const clickHouseQueryErrorsInputSchema: ClickHouseQueryErrorsInputSchema =
  clickHouseQueryErrorsInputSchemaDefinition;
export type ClickHouseQueryErrorsInput = z.infer<typeof clickHouseQueryErrorsInputSchema>;

/** One group of failed statements: one normalized shape, one source, one error code. */
const clickHouseQueryErrorGroupSchemaDefinition = z
  .object({
    /** ClickHouse's `normalized_query_hash`, as decimal text. */
    queryShapeId: z.string(),
    source: clickHouseQuerySourceSchema,
    code: z.number().int(),
    /** ClickHouse's name for the code, such as `MEMORY_LIMIT_EXCEEDED`. */
    codeName: z.string(),
    count: z.number().int().nonnegative(),
    p95Ms: z.number().nonnegative(),
    maxMemoryBytes: z.number().nonnegative(),
    rowsRead: z.number().nonnegative(),
    /** The projects a LangWatchQL run was scoped to, at most twenty. */
    projectIds: z.array(z.string()).max(CLICKHOUSE_QUERY_ERROR_MAX_PROJECTS),
    /** Epoch milliseconds of the newest failure in the group. */
    lastAt: z.number(),
  })
  .strict();
export interface ClickHouseQueryErrorGroupSchema extends Named<
  typeof clickHouseQueryErrorGroupSchemaDefinition
> {}
export const clickHouseQueryErrorGroupSchema: ClickHouseQueryErrorGroupSchema =
  clickHouseQueryErrorGroupSchemaDefinition;
export type ClickHouseQueryErrorGroup = z.infer<typeof clickHouseQueryErrorGroupSchema>;

/** One table's active parts: the most on any one node, never a part or partition name. */
const clickHouseTablePartsSchemaDefinition = z
  .object({
    table: z.string(),
    activeParts: z.number().int().nonnegative(),
    maxPartsInPartition: z.number().int().nonnegative(),
    bytesOnDisk: z.number().nonnegative(),
  })
  .strict();
export type ClickHouseTableParts = z.infer<typeof clickHouseTablePartsSchemaDefinition>;

/** The server's health across the nodes the app can reach; a missing reading is zero. */
const clickHouseServerHealthSchemaDefinition = z
  .object({
    nodes: z.number().int().nonnegative(),
    replicas: z
      .object({
        tables: z.number().int().nonnegative(),
        readonly: z.number().int().nonnegative(),
        sessionExpired: z.number().int().nonnegative(),
        maxDelaySeconds: z.number().nonnegative(),
        maxQueueSize: z.number().int().nonnegative(),
      })
      .strict(),
    merges: z
      .object({
        running: z.number().int().nonnegative(),
        longestSeconds: z.number().nonnegative(),
        pendingMutations: z.number().int().nonnegative(),
      })
      .strict(),
    disks: z
      .object({
        count: z.number().int().nonnegative(),
        totalBytes: z.number().nonnegative(),
        freeBytes: z.number().nonnegative(),
        /** The fullest disk's free share, 0 to 1; 1 when no disk answered. */
        lowestFreeRatio: z.number().min(0).max(1),
      })
      .strict(),
    memory: z
      .object({
        residentBytes: z.number().nonnegative(),
        totalBytes: z.number().nonnegative(),
      })
      .strict(),
    tables: z.array(clickHouseTablePartsSchemaDefinition),
  })
  .strict();
export interface ClickHouseServerHealthSchema extends Named<
  typeof clickHouseServerHealthSchemaDefinition
> {}
export const clickHouseServerHealthSchema: ClickHouseServerHealthSchema =
  clickHouseServerHealthSchemaDefinition;
export type ClickHouseServerHealth = z.infer<typeof clickHouseServerHealthSchema>;
