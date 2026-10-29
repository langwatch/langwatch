/**
 * Every `analytics.lwql.*` procedure, declared once. The dotted namespace is the
 * browser's cache key and the audit path both, and nothing here validates SQL.
 * @see modules/analytics/specs/analytics-lwql-workbench.feature
 */
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import { lwqlProjectsSchema, lwqlStatementSchema } from "./analytics-lwql.schemas.ts";
import {
  langWatchQLAvailabilitySchema,
  langWatchQLQueryResultSchema,
  langWatchQLSchema,
  traceSourcesSchema,
} from "./analytics.lwql.ts";
import {
  LWQL_CLAUSES,
  LWQL_VIOLATION_CODES,
  type LangWatchQLViolation,
} from "./langwatch-ql-violation.ts";

/** The project every workbench question is asked about. */
const lwqlProjectScopeSchemaDefinition = z.object({ projectId: z.string() });
export interface LwqlProjectScopeSchema extends Named<typeof lwqlProjectScopeSchemaDefinition> {}
export const lwqlProjectScopeSchema: LwqlProjectScopeSchema = lwqlProjectScopeSchemaDefinition;

/** One statement, run for one project. */
const lwqlRunRequestSchemaDefinition = z.object({
  ...lwqlProjectScopeSchema.shape,
  ...lwqlStatementSchema.shape,
});
export interface LwqlRunRequestSchema extends Named<typeof lwqlRunRequestSchemaDefinition> {}
export const lwqlRunRequestSchema: LwqlRunRequestSchema = lwqlRunRequestSchemaDefinition;

/**
 * One statement run, kept to the trace origins a dashboard query counts (dashboards-v2 AC200):
 * its stored list, or `null` when it stores none, which the server reads as the default. Absent,
 * the run is no widget's and reads every origin. The REST query runs what it is sent.
 */
const lwqlQueryRequestSchemaDefinition = z.object({
  ...lwqlRunRequestSchema.shape,
  sources: traceSourcesSchema.readonly().nullable().optional(),
  /** The projects the card reads; absent, the board's project (AC206). */
  projects: lwqlProjectsSchema.optional(),
});
export interface LwqlQueryRequestSchema extends Named<typeof lwqlQueryRequestSchemaDefinition> {}
export const lwqlQueryRequestSchema: LwqlQueryRequestSchema = lwqlQueryRequestSchemaDefinition;

/** One refusal, positioned where the parser or the policy found it. */
export const lwqlViolationSchema: z.ZodType<LangWatchQLViolation> = z
  .object({
    code: z.enum(LWQL_VIOLATION_CODES),
    clause: z.enum(LWQL_CLAUSES),
    message: z.string(),
    at: z.object({ line: z.number(), column: z.number() }).optional(),
    hint: z.string(),
    allowedFunctions: z.array(z.string()).readonly().optional(),
    availableViews: z.array(z.string()).readonly().optional(),
    view: z.string().optional(),
    availableColumns: z.array(z.string()).readonly().optional(),
    maxRows: z.number().optional(),
    missingGates: z.array(z.string()).readonly().optional(),
  })
  .strict();

/** What the policy says of a statement: every refusal, none when it would be admitted. */
const lwqlValidationResultSchemaDefinition = z.object({
  violations: z.array(lwqlViolationSchema),
});
export interface LwqlValidationResultSchema extends Named<
  typeof lwqlValidationResultSchemaDefinition
> {}
export const lwqlValidationResultSchema: LwqlValidationResultSchema =
  lwqlValidationResultSchemaDefinition;

export type LangWatchQLValidationResult = z.infer<typeof lwqlValidationResultSchema>;

export const analyticsLwqlTrpc = defineTrpcContract("analytics.lwql")
  // Separate from `schema` because the catalog is answerable without an
  // executor, so a deployment with no LangWatchQL identity would describe a
  // surface it cannot run. The navigation gates on this, never on the schema.
  .query("availability")
  .withInput(lwqlProjectScopeSchema)
  .withOutput(langWatchQLAvailabilitySchema)

  /** The datasets and columns this member's permissions unlock. */
  .query("schema")
  .withInput(lwqlProjectScopeSchema)
  .withOutput(langWatchQLSchema)

  /** The statement's refusals for this member, with positions. Never executes. */
  .query("validate")
  .withInput(lwqlRunRequestSchema)
  .withOutput(lwqlValidationResultSchema)

  .mutation("query")
  .withInput(lwqlQueryRequestSchema)
  .withOutput(langWatchQLQueryResultSchema)
  .build();
