import { z } from "zod";
import type { LangWatchQLTimeWindow } from "./analytics.lwql-time-window";

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

export const langWatchQLSchema = z
  .object({
    database: z.string(),
    datasets: z.array(langWatchQLSchemaDatasetSchema).readonly(),
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
 * Deliberately NOT a second `LangWatchQLTimeWindow`. The name belongs to
 * `./analytics.lwql-time-window`, which is import-free and is what the browser
 * loads; this module only adds the zod validator for the same shape. The
 * annotation on the schema above is what stops the two drifting — change one
 * side's shape and it stops compiling here rather than at a call site.
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
 * Analytics' separate restricted-query lifecycle and trust boundary.
 *
 * Ordinary Analytics reads use AnalyticsService. LangWatchQL owns a distinct
 * tenant capability, restricted database identity, query ceilings, and one
 * process-owned close lifecycle, so consumers such as Dashboard depend only on
 * this contract and never on an Analytics server implementation.
 */
export abstract class LangWatchQLService {
  abstract get available(): boolean;
  abstract close(): Promise<void>;
  abstract describeSchema(input: { protections: LangWatchQLProtections }): LangWatchQLSchema;
  abstract validate(input: LangWatchQLValidationInput): unknown;
  abstract execute(input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult>;
}
