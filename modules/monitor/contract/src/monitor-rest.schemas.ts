import type { Named } from "@langwatch/module";
/** Wire shapes for `/api/monitors`, distinct from domain schemas. */
import { z } from "zod";

import { monitorExecutionModeSchema, monitorMappingStateSchema } from "./monitor.ts";

const monitorRestIdParamsSchemaDefinition = z.object({
  id: z.string().min(1).describe("The monitor id."),
});
export interface MonitorRestIdParamsSchema extends Named<
  typeof monitorRestIdParamsSchemaDefinition
> {}
export const monitorRestIdParamsSchema: MonitorRestIdParamsSchema =
  monitorRestIdParamsSchemaDefinition;

/** Optional and nullable as on main; a legacy `{}` reads as an empty mapping. */
const monitorRestMappingsSchemaDefinition = z
  .object({
    mapping: monitorMappingStateSchema.shape.mapping.optional(),
    expansions: monitorMappingStateSchema.shape.expansions.optional(),
  })
  .nullable()
  .optional();
export interface MonitorRestMappingsSchema extends Named<
  typeof monitorRestMappingsSchemaDefinition
> {}
export const monitorRestMappingsSchema: MonitorRestMappingsSchema =
  monitorRestMappingsSchemaDefinition;

/** Any JSON list, as main accepted and stored. */
const monitorRestPreconditionsSchemaDefinition = z.array(z.unknown());
export interface MonitorRestPreconditionsSchema extends Named<
  typeof monitorRestPreconditionsSchemaDefinition
> {}
export const monitorRestPreconditionsSchema: MonitorRestPreconditionsSchema =
  monitorRestPreconditionsSchemaDefinition;

const monitorRestResponseSchemaDefinition = z.object({
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
export interface MonitorRestResponseSchema extends Named<
  typeof monitorRestResponseSchemaDefinition
> {}
export const monitorRestResponseSchema: MonitorRestResponseSchema =
  monitorRestResponseSchemaDefinition;
export type MonitorRestResponse = z.infer<typeof monitorRestResponseSchema>;

const monitorRestCreateInputSchemaDefinition = z.object({
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
export interface MonitorRestCreateInputSchema extends Named<
  typeof monitorRestCreateInputSchemaDefinition
> {}
export const monitorRestCreateInputSchema: MonitorRestCreateInputSchema =
  monitorRestCreateInputSchemaDefinition;

const monitorRestUpdateInputSchemaDefinition = z.object({
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
export interface MonitorRestUpdateInputSchema extends Named<
  typeof monitorRestUpdateInputSchemaDefinition
> {}
export const monitorRestUpdateInputSchema: MonitorRestUpdateInputSchema =
  monitorRestUpdateInputSchemaDefinition;

const monitorRestToggleInputSchemaDefinition = z.object({ enabled: z.boolean() });
export interface MonitorRestToggleInputSchema extends Named<
  typeof monitorRestToggleInputSchemaDefinition
> {}
export const monitorRestToggleInputSchema: MonitorRestToggleInputSchema =
  monitorRestToggleInputSchemaDefinition;
const monitorRestToggledSchemaDefinition = z.object({ id: z.string(), enabled: z.boolean() });
export interface MonitorRestToggledSchema extends Named<
  typeof monitorRestToggledSchemaDefinition
> {}
export const monitorRestToggledSchema: MonitorRestToggledSchema =
  monitorRestToggledSchemaDefinition;
const monitorRestDeletedSchemaDefinition = z.object({ id: z.string(), deleted: z.boolean() });
export interface MonitorRestDeletedSchema extends Named<
  typeof monitorRestDeletedSchemaDefinition
> {}
export const monitorRestDeletedSchema: MonitorRestDeletedSchema =
  monitorRestDeletedSchemaDefinition;
