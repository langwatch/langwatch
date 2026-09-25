/** Wire shapes for `/api/monitors`, distinct from domain schemas. */
import { z } from "zod";

import { monitorExecutionModeSchema, monitorMappingStateSchema } from "./monitor.ts";

export const monitorRestIdParamsSchema = z.object({
  monitorId: z.string().min(1).describe("The monitor id."),
});

/** Optional and nullable as on main; a legacy `{}` reads as an empty mapping. */
export const monitorRestMappingsSchema = z
  .object({
    mapping: monitorMappingStateSchema.shape.mapping.optional(),
    expansions: monitorMappingStateSchema.shape.expansions.optional(),
  })
  .nullable()
  .optional();

/** Any JSON list, as main accepted and stored. */
export const monitorRestPreconditionsSchema = z.array(z.unknown());

export const monitorRestResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  checkType: z.string(),
  enabled: z.boolean(),
  executionMode: monitorExecutionModeSchema,
  sample: z.number(),
  level: z.string(),
  evaluatorId: z.string().nullable(),
  preconditions: z.unknown(),
  parameters: z.unknown(),
  mappings: z.unknown().nullable(),
  threadIdleTimeout: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  platformUrl: z.string().url(),
});
export type MonitorRestResponse = z.infer<typeof monitorRestResponseSchema>;

export const monitorRestCreateInputSchema = z.object({
  name: z.string().min(1, "name is required"),
  checkType: z.string().min(1, "checkType is required"),
  executionMode: monitorExecutionModeSchema.default("ON_MESSAGE"),
  preconditions: monitorRestPreconditionsSchema.default([]),
  parameters: z.record(z.string(), z.json()).default({}),
  mappings: monitorRestMappingsSchema,
  sample: z.number().min(0).max(1).default(1.0),
  evaluatorId: z.string().min(1).optional(),
  level: z.enum(["trace", "thread"]).default("trace"),
  threadIdleTimeout: z.number().int().positive().nullable().optional(),
});

export const monitorRestUpdateInputSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  checkType: z.string().optional(),
  executionMode: monitorExecutionModeSchema.optional(),
  preconditions: monitorRestPreconditionsSchema.optional(),
  parameters: z.record(z.string(), z.json()).optional(),
  mappings: monitorRestMappingsSchema,
  sample: z.number().min(0).max(1).optional(),
  evaluatorId: z.string().min(1).nullable().optional(),
  level: z.enum(["trace", "thread"]).optional(),
  threadIdleTimeout: z.number().int().positive().nullable().optional(),
});

export const monitorRestToggleInputSchema = z.object({ enabled: z.boolean() });
export const monitorRestToggledSchema = z.object({ id: z.string(), enabled: z.boolean() });
export const monitorRestDeletedSchema = z.object({ id: z.string(), deleted: z.boolean() });
