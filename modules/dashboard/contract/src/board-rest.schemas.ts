/**
 * The Dashboards REST wire shapes: `/api/v1/dashboards` and its widgets, and the
 * `/api/v1/projects/:projectId/analytics/boards` reads.
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  dashboardDescriptionSchema,
  dashboardIdSchema,
  dashboardNameSchema,
  dashboardScopeSchema,
  projectIdSchema,
} from "./dashboard.ts";

const boardResourceSchemaDefinition = z.object({
  id: dashboardIdSchema,
  name: dashboardNameSchema,
  /** `null` until a member writes one. */
  description: z.string().nullable(),
  /** Who sees the dashboard; a project credential never reads one set to Only me. */
  scope: dashboardScopeSchema,
  /** The member who made it; `null` for a dashboard a project credential made. */
  createdById: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  platformUrl: z.string(),
});
export interface BoardResourceSchema extends Named<typeof boardResourceSchemaDefinition> {}
export const boardResourceSchema: BoardResourceSchema = boardResourceSchemaDefinition;

/** One row of the list, which also reports how many widgets the dashboard holds. */
const boardListItemSchemaDefinition = z.object({
  ...boardResourceSchema.shape,
  widgetCount: z.number().int().nonnegative(),
});
export interface BoardListItemSchema extends Named<typeof boardListItemSchemaDefinition> {}
export const boardListItemSchema: BoardListItemSchema = boardListItemSchemaDefinition;

const boardListSchemaDefinition = z.object({ data: z.array(boardListItemSchema) });
export interface BoardListSchema extends Named<typeof boardListSchemaDefinition> {}
export const boardListSchema: BoardListSchema = boardListSchemaDefinition;

const boardProjectParamsSchemaDefinition = z.object({ projectId: projectIdSchema });
export interface BoardProjectParamsSchema extends Named<
  typeof boardProjectParamsSchemaDefinition
> {}
export const boardProjectParamsSchema: BoardProjectParamsSchema =
  boardProjectParamsSchemaDefinition;

const boardParamsSchemaDefinition = z.object({
  ...boardProjectParamsSchema.shape,
  dashboardId: dashboardIdSchema,
});
export interface BoardParamsSchema extends Named<typeof boardParamsSchemaDefinition> {}
export const boardParamsSchema: BoardParamsSchema = boardParamsSchemaDefinition;

// -- `/api/v1/dashboards`: the project comes from the key, never the path -----

const boardIdParamsSchemaDefinition = z.object({ dashboardId: dashboardIdSchema });
export interface BoardIdParamsSchema extends Named<typeof boardIdParamsSchemaDefinition> {}
export const boardIdParamsSchema: BoardIdParamsSchema = boardIdParamsSchemaDefinition;

const boardWidgetParamsSchemaDefinition = z.object({
  ...boardIdParamsSchema.shape,
  widgetId: z.string().min(1),
});
export interface BoardWidgetParamsSchema extends Named<typeof boardWidgetParamsSchemaDefinition> {}
export const boardWidgetParamsSchema: BoardWidgetParamsSchema = boardWidgetParamsSchemaDefinition;

const createBoardSchemaDefinition = z.object({ name: dashboardNameSchema });
export interface CreateBoardSchema extends Named<typeof createBoardSchemaDefinition> {}
export const createBoardSchema: CreateBoardSchema = createBoardSchemaDefinition;

const updateBoardSchemaDefinition = z
  .object({
    name: dashboardNameSchema.optional(),
    /** `null` clears it. */
    description: dashboardDescriptionSchema.nullable().optional(),
  })
  .refine(
    (body) => body.name !== undefined || body.description !== undefined,
    "Provide at least one of name or description.",
  )
  .meta({ minProperties: 1 });
export interface UpdateBoardSchema extends Named<typeof updateBoardSchemaDefinition> {}
export const updateBoardSchema: UpdateBoardSchema = updateBoardSchemaDefinition;
