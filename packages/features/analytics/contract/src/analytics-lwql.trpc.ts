/**
 * Every `analytics.lwql.*` procedure, declared once. The dotted namespace is the
 * browser's cache key and the audit path both, and nothing here validates SQL.
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { lwqlStatementSchema } from "./analytics-lwql.schemas.ts";
import {
  langWatchQLAvailabilitySchema,
  langWatchQLQueryResultSchema,
  langWatchQLSchema,
} from "./analytics.lwql.ts";

/** The project every workbench question is asked about. */
export const lwqlProjectScopeSchema = z.object({ projectId: z.string() });

/** One statement, run for one project. */
export const lwqlRunRequestSchema = z.object({
  ...lwqlProjectScopeSchema.shape,
  ...lwqlStatementSchema.shape,
});

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

  .mutation("query")
  .withInput(lwqlRunRequestSchema)
  .withOutput(langWatchQLQueryResultSchema)
  .build();
