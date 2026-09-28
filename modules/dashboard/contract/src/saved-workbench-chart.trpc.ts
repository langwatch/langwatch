/**
 * Every saved LangWatchQL workbench chart procedure, declared once. A member
 * namespace of `analytics`, main's wire, while the subject belongs to
 * Dashboard. Spec: lwql-saved-charts.feature.
 */
import {
  langWatchQLQueryResultSchema,
  lwqlGranularityStepSchema,
  lwqlTimeWindowSchema,
} from "@langwatch/analytics-contract";
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { savedWorkbenchChartSchema } from "./saved-workbench-chart.ts";

const projectScopeSchema = z.object({ projectId: z.string() });
const chartScopeSchema = z.object({ ...projectScopeSchema.shape, id: z.string() });

/** Request shape only — length, not meaning. */
const nameSchema = z.string().min(1).max(200);

export const savedWorkbenchChartDeletedSchema = z.object({ success: z.literal(true) });

export const savedWorkbenchChartTrpc = defineTrpcContract("analytics.savedWorkbenchCharts")
  .query("getAll")
  .withInput(projectScopeSchema)
  .withOutput(savedWorkbenchChartSchema.array())

  .query("getById")
  .withInput(chartScopeSchema)
  .withOutput(savedWorkbenchChartSchema)

  /**
   * `definition` stays `unknown`: the versioned schema is the application's,
   * and it answers a bad one with a `validation_error` a form binds to.
   */
  .mutation("create")
  .withInput(z.object({ ...projectScopeSchema.shape, name: nameSchema, definition: z.unknown() }))
  .withOutput(savedWorkbenchChartSchema)

  /**
   * The author's protections are resolved for THIS request rather than
   * remembered from the save, so a member whose permissions narrowed cannot
   * update a chart into naming a column they may no longer read.
   */
  .mutation("update")
  .withInput(
    z.object({
      ...chartScopeSchema.shape,
      name: nameSchema.optional(),
      definition: z.unknown().optional(),
    }),
  )
  .withOutput(savedWorkbenchChartSchema)

  /**
   * The period and the datapoint step come from this request, never from the
   * stored definition. `onBudgetOverflow` defaults to refusing; a dashboard
   * widget passes `"coarsen"` so its saved step meets the period on screen.
   */
  .mutation("run")
  .withInput(
    z.object({
      ...chartScopeSchema.shape,
      timeWindow: lwqlTimeWindowSchema.optional(),
      granularitySeconds: lwqlGranularityStepSchema.optional(),
      onBudgetOverflow: z.enum(["refuse", "coarsen"]).optional(),
    }),
  )
  .withOutput(langWatchQLQueryResultSchema)

  .mutation("delete")
  .withInput(chartScopeSchema)
  .withOutput(savedWorkbenchChartDeletedSchema)
  .build();
