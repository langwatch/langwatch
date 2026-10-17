/**
 * The Dashboards boards REST family's wire shapes, under
 * `/api/v1/projects/:projectId/analytics/boards`: the boards a widget can be added to.
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
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
  /** Who sees the board; a project credential never reads one set to Only me. */
  scope: dashboardScopeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  platformUrl: z.string(),
});
export interface BoardResourceSchema extends Named<typeof boardResourceSchemaDefinition> {}
export const boardResourceSchema: BoardResourceSchema = boardResourceSchemaDefinition;

/** One row of the list, which also reports how many widgets the board holds. */
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
  boardId: dashboardIdSchema,
});
export interface BoardParamsSchema extends Named<typeof boardParamsSchemaDefinition> {}
export const boardParamsSchema: BoardParamsSchema = boardParamsSchemaDefinition;
