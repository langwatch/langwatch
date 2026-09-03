/**
 * A connected agent's config: an agent the SDK registered from a decorated
 * function in the customer's own code (ADR-128).
 *
 * The config holds what the function declares and nothing about the runtime.
 * Presence lives on `Agent.lastSeenAt` and in the gateway's own store, so a
 * config read here never says whether an instance is up.
 *
 * The parameter shape is restated here rather than imported from the scenario
 * contract for the reason `connected-agent.protocol.ts` restates the name
 * grammar: this package stays zod-only, and a dependency on the scenario
 * contract would make the agent contract heavier than the wire it describes.
 * The two shapes are the same by test, not by import.
 */
import { z } from "zod";
import { baseAgentConfigSchema } from "./base";

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

export const connectedAgentConfigSchema = baseAgentConfigSchema.omit({ description: true }).extend({
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
