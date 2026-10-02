/**
 * Every `analytics.lwql.*` procedure, declared once. The dotted namespace is the
 * browser's cache key and the audit path both, and nothing here validates SQL.
 * @see modules/analytics/specs/analytics-lwql-workbench.feature
 */
import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import { lwqlStatementSchema } from "./analytics-lwql.schemas.ts";
import {
  langWatchQLAvailabilitySchema,
  langWatchQLQueryResultSchema,
  langWatchQLSchema,
} from "./analytics.lwql.ts";
import {
  LWQL_CLAUSES,
  LWQL_VIOLATION_CODES,
  type LangWatchQLViolation,
} from "./langwatch-ql-violation.ts";

/** The project every workbench question is asked about. */
export const lwqlProjectScopeSchema = z.object({ projectId: z.string() });

/** One statement, run for one project. */
export const lwqlRunRequestSchema = z.object({
  ...lwqlProjectScopeSchema.shape,
  ...lwqlStatementSchema.shape,
});

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
  })
  .strict();

/** What the policy says of a statement: every refusal, none when it would be admitted. */
export const lwqlValidationResultSchema = z.object({
  violations: z.array(lwqlViolationSchema),
});

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
  .withInput(lwqlRunRequestSchema)
  .withOutput(langWatchQLQueryResultSchema)
  .build();
