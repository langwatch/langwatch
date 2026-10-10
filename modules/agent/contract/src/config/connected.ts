import type { Named } from "@langwatch/module";
/** SDK-declared configuration; runtime presence is stored separately (ADR-128). */
import { z } from "zod";

import { baseAgentConfigSchema } from "./code.ts";

const connectedParameterValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/** What a connected function declares about one of its parameters. */
const connectedParameterDefinitionSchemaDefinition = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    defaultValue: connectedParameterValueSchema.optional(),
    secret: z.boolean().optional(),
    type: z.enum(["string", "number", "boolean"]).optional(),
    options: z.array(connectedParameterValueSchema).optional(),
    required: z.boolean().optional(),
  })
  .strict();
export interface ConnectedParameterDefinitionSchema extends Named<
  typeof connectedParameterDefinitionSchemaDefinition
> {}
export const connectedParameterDefinitionSchema: ConnectedParameterDefinitionSchema =
  connectedParameterDefinitionSchemaDefinition;

const connectedAgentConfigSchemaDefinition = z.object({
  ...baseAgentConfigSchema.omit({ description: true }).shape,
  parameters: z.array(connectedParameterDefinitionSchema).default([]),
  /** Per-call budget in milliseconds, capped by the platform. */
  timeoutMs: z.number().int().positive().optional(),
  /** Calls one instance takes at once; the SDK's default applies when absent. */
  concurrency: z.number().int().positive().optional(),
  /** Whether a thread is pinned to the instance that served its first turn. */
  sticky: z.boolean().optional(),
  sdk: z.object({
    name: z.string(),
    version: z.string(),
    language: z.string(),
  }),
});
export interface ConnectedAgentConfigSchema extends Named<
  typeof connectedAgentConfigSchemaDefinition
> {}
export const connectedAgentConfigSchema: ConnectedAgentConfigSchema =
  connectedAgentConfigSchemaDefinition;

export type ConnectedAgentConfig = z.infer<typeof connectedAgentConfigSchema>;
