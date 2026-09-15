/** SDK-declared configuration; runtime presence is stored separately (ADR-128). */
import { z } from "zod";
import { baseAgentConfigSchema } from "./base.ts";

const connectedParameterValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/** What a connected function declares about one of its parameters. */
export const connectedParameterDefinitionSchema = z
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

export const connectedAgentConfigSchema = z.object({
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

export type ConnectedAgentConfig = z.infer<typeof connectedAgentConfigSchema>;
