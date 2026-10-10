/**
 * Every `graphs.*` procedure, declared once: its name, its kind, what it
 * takes and what it answers, stated once in the package both sides import.
 * Spec: dashboard-service.feature.
 */
import {
  CHART_GRID_DEFAULT_COL_SPAN,
  chartGridPlacementSchema,
  fitsChartGridWidth,
} from "@langwatch/analytics-contract/chart-grid";
import { jsonTextField } from "@langwatch/api/json-text-field";
import { triggerSchema } from "@langwatch/automation-contract";
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import { graphSchema } from "./graph.ts";

const fitsGridWidth = {
  message: "gridColumn + colSpan must not exceed the grid's columns",
  path: ["colSpan"],
};

/**
 * `create` takes each placement field optionally and persists the grid's
 * default for an omitted one, so the width check runs on the placement the
 * row will carry.
 */
const graphApiCreateInputSchemaDefinition = z
  .object({
    projectId: z.string(),
    name: z.string(),
    graph: jsonTextField(z.record(z.string(), z.unknown())),
    filterParams: z.any().optional(),
    dashboardId: z.string().optional(),
    ...chartGridPlacementSchema.partial().shape,
  })
  .refine(
    (value) =>
      fitsChartGridWidth({
        gridColumn: value.gridColumn ?? 0,
        colSpan: value.colSpan ?? CHART_GRID_DEFAULT_COL_SPAN,
      }),
    fitsGridWidth,
  );
export interface GraphApiCreateInputSchema extends Named<
  typeof graphApiCreateInputSchemaDefinition
> {}
export const graphApiCreateInputSchema: GraphApiCreateInputSchema =
  graphApiCreateInputSchemaDefinition;

/** One project's graphs, optionally narrowed to one dashboard. */
const graphApiListInputSchemaDefinition = z.object({
  projectId: z.string(),
  dashboardId: z.string().optional(),
});
export interface GraphApiListInputSchema extends Named<typeof graphApiListInputSchemaDefinition> {}
export const graphApiListInputSchema: GraphApiListInputSchema = graphApiListInputSchemaDefinition;

/** One graph inside one project. */
const graphApiGraphInputSchemaDefinition = z.object({
  projectId: z.string(),
  id: z.string(),
});
export interface GraphApiGraphInputSchema extends Named<
  typeof graphApiGraphInputSchemaDefinition
> {}
export const graphApiGraphInputSchema: GraphApiGraphInputSchema =
  graphApiGraphInputSchemaDefinition;

const graphApiUpdateInputSchemaDefinition = z.object({
  projectId: z.string(),
  name: z.string(),
  graph: jsonTextField(z.record(z.string(), z.unknown())),
  graphId: z.string(),
  filterParams: z.any().optional(),
});
export interface GraphApiUpdateInputSchema extends Named<
  typeof graphApiUpdateInputSchemaDefinition
> {}
export const graphApiUpdateInputSchema: GraphApiUpdateInputSchema =
  graphApiUpdateInputSchemaDefinition;

const graphApiUpdateLayoutInputSchemaDefinition = z
  .object({
    projectId: z.string(),
    graphId: z.string(),
    ...chartGridPlacementSchema.shape,
  })
  .refine(fitsChartGridWidth, fitsGridWidth);
export interface GraphApiUpdateLayoutInputSchema extends Named<
  typeof graphApiUpdateLayoutInputSchemaDefinition
> {}
export const graphApiUpdateLayoutInputSchema: GraphApiUpdateLayoutInputSchema =
  graphApiUpdateLayoutInputSchemaDefinition;

const graphApiBatchUpdateLayoutsInputSchemaDefinition = z.object({
  projectId: z.string(),
  layouts: z.array(
    z
      .object({ graphId: z.string(), ...chartGridPlacementSchema.shape })
      .refine(fitsChartGridWidth, fitsGridWidth),
  ),
});
export interface GraphApiBatchUpdateLayoutsInputSchema extends Named<
  typeof graphApiBatchUpdateLayoutsInputSchemaDefinition
> {}
export const graphApiBatchUpdateLayoutsInputSchema: GraphApiBatchUpdateLayoutsInputSchema =
  graphApiBatchUpdateLayoutsInputSchemaDefinition;

export type GraphApiCreateInput = z.infer<typeof graphApiCreateInputSchema>;
export type GraphApiListInput = z.infer<typeof graphApiListInputSchema>;
export type GraphApiGraphInput = z.infer<typeof graphApiGraphInputSchema>;
export type GraphApiUpdateInput = z.infer<typeof graphApiUpdateInputSchema>;
export type GraphApiUpdateLayoutInput = z.infer<typeof graphApiUpdateLayoutInputSchema>;
export type GraphApiBatchUpdateLayoutsInput = z.infer<typeof graphApiBatchUpdateLayoutsInputSchema>;

/** Compatibility shape: the old Prisma transport exposed the discriminator. */
const legacyGraphSchemaDefinition = z
  .object({ ...graphSchema.shape, kind: z.literal("builder") })
  .strict();
export interface LegacyGraphSchema extends Named<typeof legacyGraphSchemaDefinition> {}
export const legacyGraphSchema: LegacyGraphSchema = legacyGraphSchemaDefinition;
export type LegacyGraph = z.infer<typeof legacyGraphSchema>;

const filterValueSchema = z.union([z.array(z.string()), z.record(z.string(), z.array(z.string()))]);

const alertActionParamsSchema = z
  .object({
    members: z.array(z.string()).optional(),
    seriesName: z.string().optional(),
    slackIntegrationId: z.string().optional(),
    slackChannelId: z.string().optional(),
  })
  .strict();

const graphAlertSchemaDefinition = z
  .object({
    enabled: z.literal(true),
    threshold: z.number(),
    operator: z.string(),
    timePeriod: z.number(),
    seriesName: z.string(),
    type: triggerSchema.shape.alertType,
    action: triggerSchema.shape.action,
    actionParams: alertActionParamsSchema,
    triggerId: z.string(),
  })
  .strict();
export interface GraphAlertSchema extends Named<typeof graphAlertSchemaDefinition> {}
export const graphAlertSchema: GraphAlertSchema = graphAlertSchemaDefinition;
export type GraphAlert = z.infer<typeof graphAlertSchema>;

const graphTriggerSchema = z
  .object({ ...triggerSchema.shape, actionParams: z.record(z.string(), z.unknown()) })
  .strict();

const graphListItemSchemaDefinition = z
  .object({ ...legacyGraphSchema.shape, trigger: graphTriggerSchema.nullable() })
  .strict();
export interface GraphListItemSchema extends Named<typeof graphListItemSchemaDefinition> {}
export const graphListItemSchema: GraphListItemSchema = graphListItemSchemaDefinition;

const graphDetailSchemaDefinition = z
  .object({
    ...legacyGraphSchema.shape,
    filters: z.record(z.string(), filterValueSchema).optional(),
    alert: graphAlertSchema.optional(),
  })
  .strict();
export interface GraphDetailSchema extends Named<typeof graphDetailSchemaDefinition> {}
export const graphDetailSchema: GraphDetailSchema = graphDetailSchemaDefinition;

const graphLayoutsUpdatedSchemaDefinition = z.object({ success: z.literal(true) });
export interface GraphLayoutsUpdatedSchema extends Named<
  typeof graphLayoutsUpdatedSchemaDefinition
> {}
export const graphLayoutsUpdatedSchema: GraphLayoutsUpdatedSchema =
  graphLayoutsUpdatedSchemaDefinition;

export const graphTrpc = defineTrpcContract("graphs")
  .mutation("create")
  .withInput(graphApiCreateInputSchema)
  .withOutput(legacyGraphSchema)

  /**
   * `listGraphs` returns chart-builder rows only, so a member's stored
   * LangWatchQL definition never reaches this payload.
   */
  .query("getAll")
  .withInput(graphApiListInputSchema)
  .withOutput(graphListItemSchema.array())

  .mutation("delete")
  .withInput(graphApiGraphInputSchema)
  .withOutput(legacyGraphSchema)

  .query("getById")
  .withInput(graphApiGraphInputSchema)
  .withOutput(graphDetailSchema)

  .mutation("updateById")
  .withInput(graphApiUpdateInputSchema)
  .withOutput(legacyGraphSchema)

  .mutation("updateLayout")
  .withInput(graphApiUpdateLayoutInputSchema)
  .withOutput(legacyGraphSchema)

  .mutation("batchUpdateLayouts")
  .withInput(graphApiBatchUpdateLayoutsInputSchema)
  .withOutput(graphLayoutsUpdatedSchema)
  .build();
