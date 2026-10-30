import type { Named } from "@langwatch/module";
import { z } from "zod";

import { agentHooksSchema } from "../connected-agent.protocol.ts";
import { agentInputBindingSchema } from "../fields.ts";
import { baseAgentConfigSchema } from "./code.ts";

const httpHeaderSchemaDefinition = z.object({
  key: z.string(),
  value: z.string(),
});
export interface HttpHeaderSchema extends Named<typeof httpHeaderSchemaDefinition> {}
export const httpHeaderSchema: HttpHeaderSchema = httpHeaderSchemaDefinition;

const httpAuthSchemaDefinition = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), token: z.string() }),
  z.object({
    type: z.literal("api_key"),
    header: z.string(),
    value: z.string(),
  }),
  z.object({
    type: z.literal("basic"),
    username: z.string(),
    password: z.string(),
  }),
]);
export interface HttpAuthSchema extends Named<typeof httpAuthSchemaDefinition> {}
export const httpAuthSchema: HttpAuthSchema = httpAuthSchemaDefinition;

const previousSigningSecretSchemaDefinition = z.object({
  /** The `{{ secrets.NAME }}` reference of the secret a rotation replaced. */
  secret: z.string(),
  /** ISO instant the old secret stops signing: `WEBHOOK_PREVIOUS_SECRET_TTL_MS` after rotation. */
  expiresAt: z.string(),
});
export interface PreviousSigningSecretSchema extends Named<
  typeof previousSigningSecretSchemaDefinition
> {}
/** A hooks signing secret a rotation replaced, still signed with until it expires (ADR-188). */
export const previousSigningSecretSchema: PreviousSigningSecretSchema =
  previousSigningSecretSchemaDefinition;
export type PreviousSigningSecret = z.infer<typeof previousSigningSecretSchema>;

export const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;

const httpAgentConfigSchemaDefinition = z.object({
  ...baseAgentConfigSchema.shape,
  url: z.string().min(1, "URL is required"),
  method: z.enum(HTTP_METHODS).default("POST"),
  headers: z.array(httpHeaderSchema).optional(),
  auth: httpAuthSchema.optional(),
  bodyTemplate: z.string().optional(),
  outputPath: z.string().optional(),
  sessionPath: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
  scenarioMappings: z.record(z.string(), agentInputBindingSchema).optional(),
  /** Where a scenario run POSTs its setup and teardown; absent means no hooks (ADR-188). */
  hooksUrl: z.string().optional(),
  /** The hooks a scenario run calls; only a checked one is called. */
  hooks: agentHooksSchema.optional(),
  /** Signs every hook call. Saved as a project secret, so the config keeps its reference. */
  // Blank keeps the stored reference; a typed one is at least 16 characters so redaction of it
  // cannot wreck unrelated text. Generated ones are `whsec_` + 64 hex.
  hooksSigningSecret: z
    .string()
    .refine((value) => value === "" || value.length >= 16, "must be at least 16 characters")
    .optional(),
  /**
   * Set by the server when a save rotates the signing secret on the same hooks origin, so a
   * receiver can swap secrets on its own schedule; a value a write sends is ignored.
   */
  hooksPreviousSigningSecret: previousSigningSecretSchema.optional(),
  devTunnel: z
    .object({
      previousUrl: z.string().optional(),
      connectedAt: z.string().optional(),
      heartbeatAt: z.string().optional(),
    })
    .optional(),
});
export interface HttpAgentConfigSchema extends Named<typeof httpAgentConfigSchemaDefinition> {}
export const httpAgentConfigSchema: HttpAgentConfigSchema = httpAgentConfigSchemaDefinition;

export type HttpHeader = z.infer<typeof httpHeaderSchema>;
export type HttpAuth = z.infer<typeof httpAuthSchema>;
export type HttpAuthType = HttpAuth["type"];
export type HttpMethod = (typeof HTTP_METHODS)[number];
export type HttpAgentConfig = z.infer<typeof httpAgentConfigSchema>;
