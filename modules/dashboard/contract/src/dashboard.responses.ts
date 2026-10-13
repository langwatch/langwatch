import type { Named } from "@langwatch/module";
/**
 * What `/api/dashboards` and `/api/graphs` answer with: no `projectId` (the
 * credential names the project) and a `platformUrl` the reader opens.
 */
import { z } from "zod";

import { dashboardIdSchema, dashboardNameSchema, dashboardSchema } from "./dashboard.ts";
import { graphSchema } from "./graph.ts";

/**
 * What the `dashboards.*` tRPC transport answers. Unlike the REST responses
 * below, these carry the stored row untouched (`projectId`, dates as `Date`,
 * no `platformUrl`) — the tRPC client reads the same shape the service holds.
 */

/** `getAll`: each dashboard, with the card count the grid renders. */
const dashboardTrpcSummarySchemaDefinition = z
  .object({
    ...dashboardSchema.shape,
    _count: z.object({ graphs: z.number().int().nonnegative() }).strict(),
  })
  .strict();
export interface DashboardTrpcSummarySchema extends Named<
  typeof dashboardTrpcSummarySchemaDefinition
> {}
export const dashboardTrpcSummarySchema: DashboardTrpcSummarySchema =
  dashboardTrpcSummarySchemaDefinition;

/** `getById`: one dashboard with its graphs, in grid order. */
const dashboardTrpcDetailSchemaDefinition = z
  .object({ ...dashboardSchema.shape, graphs: z.array(graphSchema) })
  .strict();
export interface DashboardTrpcDetailSchema extends Named<
  typeof dashboardTrpcDetailSchemaDefinition
> {}
export const dashboardTrpcDetailSchema: DashboardTrpcDetailSchema =
  dashboardTrpcDetailSchemaDefinition;

/** `create` / `rename` / `delete` / `getOrCreateFirst`: the raw stored row. */
export const dashboardTrpcRowSchema = dashboardSchema;

const dashboardOrderSchema = z.number().int().nonnegative();

/** The fields every dashboard answer carries. */
const dashboardWireBaseSchema = z.object({
  id: dashboardIdSchema,
  name: dashboardNameSchema,
  order: dashboardOrderSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  platformUrl: z.string(),
});

/** One row of the list, which also reports how many graphs the dashboard holds. */
const dashboardListItemResponseSchemaDefinition = z.object({
  ...dashboardWireBaseSchema.shape,
  graphCount: z.number().int().nonnegative(),
});
export interface DashboardListItemResponseSchema extends Named<
  typeof dashboardListItemResponseSchemaDefinition
> {}
export const dashboardListItemResponseSchema: DashboardListItemResponseSchema =
  dashboardListItemResponseSchemaDefinition;

const dashboardListResponseSchemaDefinition = z.object({
  data: z.array(dashboardListItemResponseSchema),
});
export interface DashboardListResponseSchema extends Named<
  typeof dashboardListResponseSchemaDefinition
> {}
export const dashboardListResponseSchema: DashboardListResponseSchema =
  dashboardListResponseSchemaDefinition;

/** A dashboard as a create or a rename answers it. */
export const dashboardResponseSchema = dashboardWireBaseSchema;

/** A dashboard read on its own, which carries its graphs in grid order. */
const dashboardDetailResponseSchemaDefinition = z.object({
  ...dashboardWireBaseSchema.shape,
  graphs: z.array(graphSchema),
});
export interface DashboardDetailResponseSchema extends Named<
  typeof dashboardDetailResponseSchemaDefinition
> {}
export const dashboardDetailResponseSchema: DashboardDetailResponseSchema =
  dashboardDetailResponseSchemaDefinition;

/** A delete names only what it removed. */
const dashboardDeletedResponseSchemaDefinition = z.object({
  id: dashboardIdSchema,
  name: dashboardNameSchema,
});
export interface DashboardDeletedResponseSchema extends Named<
  typeof dashboardDeletedResponseSchemaDefinition
> {}
export const dashboardDeletedResponseSchema: DashboardDeletedResponseSchema =
  dashboardDeletedResponseSchemaDefinition;

const dashboardReorderResponseSchemaDefinition = z.object({ success: z.literal(true) });
export interface DashboardReorderResponseSchema extends Named<
  typeof dashboardReorderResponseSchemaDefinition
> {}
export const dashboardReorderResponseSchema: DashboardReorderResponseSchema =
  dashboardReorderResponseSchemaDefinition;

/**
 * One custom graph as `/api/graphs` answers it: no `projectId`, and the two
 * timestamps as ISO strings rather than dates.
 */
const graphRestResponseSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  graph: z.record(z.string(), z.unknown()),
  filters: z.record(z.string(), z.unknown()).nullable(),
  dashboardId: z.string().nullable(),
  gridColumn: z.number(),
  gridRow: z.number(),
  colSpan: z.number(),
  rowSpan: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export interface GraphRestResponseSchema extends Named<typeof graphRestResponseSchemaDefinition> {}
export const graphRestResponseSchema: GraphRestResponseSchema = graphRestResponseSchemaDefinition;

const graphListRestResponseSchemaDefinition = z.array(graphRestResponseSchema);
export interface GraphListRestResponseSchema extends Named<
  typeof graphListRestResponseSchemaDefinition
> {}
export const graphListRestResponseSchema: GraphListRestResponseSchema =
  graphListRestResponseSchemaDefinition;

const graphDeletedResponseSchemaDefinition = z.object({
  id: z.string(),
  deleted: z.boolean(),
});
export interface GraphDeletedResponseSchema extends Named<
  typeof graphDeletedResponseSchemaDefinition
> {}
export const graphDeletedResponseSchema: GraphDeletedResponseSchema =
  graphDeletedResponseSchemaDefinition;
