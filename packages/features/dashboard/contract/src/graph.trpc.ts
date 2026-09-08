/**
 * Every `graphs.*` procedure, declared once: its name, its kind, what it takes
 * and what it answers. The inputs live here so the wire shape a client is
 * typed against is stated once, in the package both sides may import.
 * Spec: packages/features/dashboard/specs/dashboard-service.feature.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { triggerSchema } from "@langwatch/automation-contract";
import { z } from "zod";

import { graphSchema } from "./graph.ts";

/**
 * Where a card sits on the dashboard grid. Shared as loose fields rather than
 * a schema because `create` takes each one optionally and the layout writes
 * take them all.
 */
export const graphApiLayoutShape = {
  gridColumn: z.number().min(0).max(1),
  gridRow: z.number().min(0),
  colSpan: z.number().min(1).max(2),
  rowSpan: z.number().min(1).max(2),
};

export const graphApiCreateInputSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  graph: z.string(),
  filterParams: z.any().optional(),
  dashboardId: z.string().optional(),
  gridColumn: graphApiLayoutShape.gridColumn.optional(),
  gridRow: graphApiLayoutShape.gridRow.optional(),
  colSpan: graphApiLayoutShape.colSpan.optional(),
  rowSpan: graphApiLayoutShape.rowSpan.optional(),
});

/** One project's graphs, optionally narrowed to one dashboard. */
export const graphApiListInputSchema = z.object({
  projectId: z.string(),
  dashboardId: z.string().optional(),
});

/** One graph inside one project. */
export const graphApiGraphInputSchema = z.object({
  projectId: z.string(),
  id: z.string(),
});

export const graphApiUpdateInputSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  graph: z.string(),
  graphId: z.string(),
  filterParams: z.any().optional(),
});

export const graphApiUpdateLayoutInputSchema = z.object({
  projectId: z.string(),
  graphId: z.string(),
  ...graphApiLayoutShape,
});

export const graphApiBatchUpdateLayoutsInputSchema = z.object({
  projectId: z.string(),
  layouts: z.array(z.object({ graphId: z.string(), ...graphApiLayoutShape })),
});

export type GraphApiCreateInput = z.infer<typeof graphApiCreateInputSchema>;
export type GraphApiListInput = z.infer<typeof graphApiListInputSchema>;
export type GraphApiGraphInput = z.infer<typeof graphApiGraphInputSchema>;
export type GraphApiUpdateInput = z.infer<typeof graphApiUpdateInputSchema>;
export type GraphApiUpdateLayoutInput = z.infer<typeof graphApiUpdateLayoutInputSchema>;
export type GraphApiBatchUpdateLayoutsInput = z.infer<typeof graphApiBatchUpdateLayoutsInputSchema>;

/** Compatibility shape: the old Prisma transport exposed the discriminator. */
export const legacyGraphSchema = z
  .object({ ...graphSchema.shape, kind: z.literal("builder") })
  .strict();
export type LegacyGraph = z.infer<typeof legacyGraphSchema>;

const filterValueSchema = z.union([z.array(z.string()), z.record(z.string(), z.array(z.string()))]);

const alertActionParamsSchema = z
  .object({
    members: z.array(z.string()).optional(),
    seriesName: z.string().optional(),
  })
  .strict();

export const graphAlertSchema = z
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
export type GraphAlert = z.infer<typeof graphAlertSchema>;

const graphTriggerSchema = z
  .object({ ...triggerSchema.shape, actionParams: z.record(z.string(), z.unknown()) })
  .strict();

export const graphListItemSchema = z
  .object({ ...legacyGraphSchema.shape, trigger: graphTriggerSchema.nullable() })
  .strict();

export const graphDetailSchema = z
  .object({
    ...legacyGraphSchema.shape,
    filters: z.record(z.string(), filterValueSchema).optional(),
    alert: graphAlertSchema.optional(),
  })
  .strict();

export const graphLayoutsUpdatedSchema = z.object({ success: z.literal(true) });

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
