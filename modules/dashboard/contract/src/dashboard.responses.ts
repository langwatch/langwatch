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
export const dashboardTrpcSummarySchema = z
  .object({
    ...dashboardSchema.shape,
    _count: z.object({ graphs: z.number().int().nonnegative() }).strict(),
  })
  .strict();

/** `getById`: one dashboard with its graphs, in grid order. */
export const dashboardTrpcDetailSchema = z
  .object({ ...dashboardSchema.shape, graphs: z.array(graphSchema) })
  .strict();

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
export const dashboardListItemResponseSchema = z.object({
  ...dashboardWireBaseSchema.shape,
  graphCount: z.number().int().nonnegative(),
});

export const dashboardListResponseSchema = z.object({
  data: z.array(dashboardListItemResponseSchema),
});

/** A dashboard as a create or a rename answers it. */
export const dashboardResponseSchema = dashboardWireBaseSchema;

/** A dashboard read on its own, which carries its graphs in grid order. */
export const dashboardDetailResponseSchema = z.object({
  ...dashboardWireBaseSchema.shape,
  graphs: z.array(graphSchema),
});

/** A delete names only what it removed. */
export const dashboardDeletedResponseSchema = z.object({
  id: dashboardIdSchema,
  name: dashboardNameSchema,
});

export const dashboardReorderResponseSchema = z.object({ success: z.literal(true) });

/**
 * One custom graph as `/api/graphs` answers it: no `projectId`, and the two
 * timestamps as ISO strings rather than dates.
 */
export const graphRestResponseSchema = z.object({
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

export const graphListRestResponseSchema = z.array(graphRestResponseSchema);

export const graphDeletedResponseSchema = z.object({
  id: z.string(),
  deleted: z.boolean(),
});
