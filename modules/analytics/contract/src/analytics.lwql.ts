import { z } from "zod";

import type { LangWatchQLTimeWindow } from "./analytics.lwql-time-window.ts";

/** One column in a LangWatchQL result. */
export const langWatchQLColumnSchema = z
  .object({
    name: z.string(),
    type: z.string(),
  })
  .strict();
export type LangWatchQLColumn = z.infer<typeof langWatchQLColumnSchema>;

/** Query cost and returned-row accounting from the backend. */
export const langWatchQLStatisticsSchema = z
  .object({
    elapsedMs: z.number(),
    rowsRead: z.number(),
    bytesRead: z.number(),
    rowsReturned: z.number(),
  })
  .strict();
export type LangWatchQLStatistics = z.infer<typeof langWatchQLStatisticsSchema>;

export const LWQL_DIAGNOSTIC_CODES = [
  "RESULT_TRUNCATED",
  "POSSIBLE_FANOUT",
  "UNBOUNDED_TIME_RANGE",
  "MISSING_TIME_BUCKETS",
  "INCOMPLETE_COMPARISON_PERIOD",
] as const;
export const langWatchQLDiagnosticCodeSchema = z.enum(LWQL_DIAGNOSTIC_CODES);
export type LangWatchQLDiagnosticCode = z.infer<typeof langWatchQLDiagnosticCodeSchema>;

/** A non-fatal note attached to a completed result. */
export const langWatchQLDiagnosticSchema = z
  .object({
    code: langWatchQLDiagnosticCodeSchema,
    message: z.string(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type LangWatchQLDiagnostic = z.infer<typeof langWatchQLDiagnosticSchema>;

/** The complete result envelope returned by the query transport. */
export const langWatchQLQueryResultSchema = z
  .object({
    columns: z.array(langWatchQLColumnSchema).readonly(),
    rows: z.array(z.record(z.string(), z.unknown())).readonly(),
    statistics: langWatchQLStatisticsSchema,
    truncated: z.boolean(),
    diagnostics: z.array(langWatchQLDiagnosticSchema).readonly(),
    followsTimeWindow: z.boolean(),
    followsGranularity: z.boolean(),
    granularitySeconds: z.number().optional(),
    coarsenedFromSeconds: z.number().optional(),
  })
  .strict();
export type LangWatchQLQueryResult = z.infer<typeof langWatchQLQueryResultSchema>;

export const langWatchQLSchemaColumnSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    description: z.string(),
    unit: z.string().nullable(),
    gates: z.array(z.string()).readonly(),
    available: z.boolean(),
  })
  .strict();
export type LangWatchQLSchemaColumn = z.infer<typeof langWatchQLSchemaColumnSchema>;

export const langWatchQLSchemaDatasetSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    grain: z.string(),
    joinKeys: z.array(z.string()).readonly(),
    timeColumn: z.string(),
    freshness: z.string(),
    columns: z.array(langWatchQLSchemaColumnSchema).readonly(),
    exampleSql: z.string(),
  })
  .strict();
export type LangWatchQLSchemaDataset = z.infer<typeof langWatchQLSchemaDatasetSchema>;

/** One app function as the schema endpoint publishes it. */
export const langWatchQLSchemaAppFunctionSchema = z
  .object({
    name: z.string(),
    /** `conversation_bounded(thread_key, max_tokens, until_trace_id)`. */
    signature: z.string(),
    description: z.string(),
    /** ClickHouse type of the hydrated column, which the result re-declares. */
    returns: z.string(),
    /** `json` for a payload a consumer should parse back, `text` for prose. */
    encoding: z.string(),
    /** What the first argument names, which is what the cap counts. */
    keyKind: z.string(),
    /**
     * Whether the value is read from a trace or judged by a model: the two
     * cost different things, a read against a metered classification per row.
     */
    kind: z.enum(["extraction", "eval"]),
    /** How many distinct keys of that kind one run may read. */
    cap: z.number(),
    /** Permissions that must all be held to call it. Empty for an ungated one. */
    gates: z.array(z.string()).readonly(),
    available: z.boolean(),
    exampleSql: z.string(),
  })
  .strict();
export type LangWatchQLSchemaAppFunction = z.infer<typeof langWatchQLSchemaAppFunctionSchema>;

export const langWatchQLSchema = z
  .object({
    database: z.string(),
    datasets: z.array(langWatchQLSchemaDatasetSchema).readonly(),
    /** Last, so every field a consumer already read keeps the position it had. */
    appFunctions: z.array(langWatchQLSchemaAppFunctionSchema).readonly(),
  })
  .strict();
export type LangWatchQLSchema = z.infer<typeof langWatchQLSchema>;

const MIN_UTC_YEAR = 0;
const MAX_UTC_YEAR = 9999;
const lwqlTimeWindowBound = z
  .union([z.string(), z.number(), z.date()])
  .pipe(z.coerce.date())
  .refine(
    (value) => {
      const year = value.getUTCFullYear();
      return year >= MIN_UTC_YEAR && year <= MAX_UTC_YEAR;
    },
    { message: `UTC year must be between ${MIN_UTC_YEAR} and ${MAX_UTC_YEAR}.` },
  );

export const lwqlTimeWindowSchema: z.ZodType<LangWatchQLTimeWindow> = z
  .object({
    start: lwqlTimeWindowBound,
    end: lwqlTimeWindowBound,
  })
  .strict();
/**
 * Deliberately NOT a second `LangWatchQLTimeWindow`: that name belongs to the import-free
 * `./analytics.lwql-time-window` the browser loads; this only adds the zod validator. The
 * schema's type annotation above stops the two drifting -- a mismatch fails to compile here.
 */

/** The tenant identity a restricted LangWatchQL execution runs as. */
export type LangWatchQLCaller = Readonly<{
  /** Project id is used for audit logging; the database enforces tenant isolation. */
  id: string;
  /** Project-scoped secret hashed into the restricted tenant capability. */
  lwqlKey: string;
}>;

/** The caller-specific content gates the LangWatchQL catalog understands. */
export type LangWatchQLProtections = Readonly<{
  canSeeCosts?: boolean | null;
  canSeeCapturedInput?: boolean | null;
  canSeeCapturedOutput?: boolean | null;
}>;

/**
 * Who a session-authenticated restricted execution runs as, plus what that member may see.
 * Dashboard reads both off `AnalyticsApi` rather than resolving either itself, so a chart and
 * the workbench agree on one caller's protections.
 */
export type LangWatchQLRunCaller = Readonly<{
  project: LangWatchQLCaller;
  protections: LangWatchQLProtections;
}>;

/** How a surface handles a saved chart whose requested period exceeds its bucket budget. */
export type LangWatchQLBudgetOverflowMode = "refuse" | "coarsen";

/** The requesting surface's trusted context for running a restricted query. */
export type LangWatchQLRunContext = Readonly<{
  project: LangWatchQLCaller;
  protections: LangWatchQLProtections;
  timeWindow?: LangWatchQLTimeWindow;
  granularitySeconds?: number;
  onBudgetOverflow?: LangWatchQLBudgetOverflowMode;
}>;

/** Input shared by every restricted LangWatchQL execution surface. */
export type LangWatchQLExecuteInput = LangWatchQLRunContext &
  Readonly<{
    sql: string;
    parameters?: Readonly<Record<string, unknown>>;
  }>;

/** Input used to admit a statement before it is stored as a reusable artifact. */
export type LangWatchQLValidationInput = Readonly<{
  projectId: string;
  protections: LangWatchQLProtections;
  sql: string;
  parameters?: Readonly<Record<string, unknown>>;
  timeWindow?: LangWatchQLTimeWindow;
}>;

/**
 * Analytics' separate restricted-query lifecycle and trust boundary. Ordinary Analytics reads
 * use AnalyticsService; LangWatchQL owns its own tenant capability, restricted identity, query
 * ceilings and close lifecycle, so consumers depend only on this contract, never a server impl.
 */
export abstract class LangWatchQLService {
  abstract get available(): boolean;
  abstract close(): Promise<void>;
  abstract describeSchema(input: { protections: LangWatchQLProtections }): LangWatchQLSchema;
  abstract validate(input: LangWatchQLValidationInput): unknown;
  abstract execute(input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult>;
}

/**
 * Which gate closed, when one did. `disabled` is the project's own switch, which an
 * administrator can change; `unprovisioned` is a deployment with no LangWatchQL identity, which
 * they cannot -- different refusals the page has to tell apart.
 */
export const langWatchQLUnavailableReasonSchema = z.enum(["disabled", "unprovisioned"]);
export type LangWatchQLUnavailableReason = z.infer<typeof langWatchQLUnavailableReasonSchema>;

/**
 * One object with an optional reason rather than a union, so a consumer that
 * only cares whether the surface is on keeps reading `available` and nothing
 * else.
 */
export const langWatchQLAvailabilitySchema = z
  .object({
    /** What the navigation entry and the page gate on. */
    available: z.boolean(),
    /** Absent when available. */
    reason: langWatchQLUnavailableReasonSchema.optional(),
  })
  .strict();
export type LangWatchQLAvailability = z.infer<typeof langWatchQLAvailabilitySchema>;
