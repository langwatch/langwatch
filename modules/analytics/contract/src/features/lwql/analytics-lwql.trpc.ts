/**
 * Every `analytics.lwql.*` procedure, declared once. The dotted namespace is the
 * browser's cache key and the audit path both, and nothing here validates SQL.
 * @see modules/analytics/specs/analytics-lwql-workbench.feature
 */
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import { lwqlMemberProjectsSchema, lwqlStatementSchema } from "./analytics-lwql.schemas.ts";
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
  sources: traceSourcesSchema.nullable().optional(),
  /** The projects the card reads; absent, the board's project (AC206). */
  projects: lwqlMemberProjectsSchema.optional(),
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

/** A project the member may name on a card's query: its id and the name the picker shows. */
const lwqlReadableProjectSchemaDefinition = z.object({ id: z.string(), name: z.string() });
export interface LwqlReadableProjectSchema extends Named<
  typeof lwqlReadableProjectSchemaDefinition
> {}
export const lwqlReadableProjectSchema: LwqlReadableProjectSchema =
  lwqlReadableProjectSchemaDefinition;
export type LangWatchQLReadableProject = z.infer<typeof lwqlReadableProjectSchema>;

const lwqlReadableProjectsSchemaDefinition = z.object({
  projects: z.array(lwqlReadableProjectSchema),
});
export interface LwqlReadableProjectsSchema extends Named<
  typeof lwqlReadableProjectsSchemaDefinition
> {}
export const lwqlReadableProjectsSchema: LwqlReadableProjectsSchema =
  lwqlReadableProjectsSchemaDefinition;

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

  /** The projects of the organization this member may read, for the editor's project picker. */
  .query("readableProjects")
  .withInput(lwqlProjectScopeSchema)
  .withOutput(lwqlReadableProjectsSchema)

  .mutation("query")
  .withInput(lwqlQueryRequestSchema)
  .withOutput(langWatchQLQueryResultSchema)
  .build();
