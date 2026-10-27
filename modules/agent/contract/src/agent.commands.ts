import { generate } from "@langwatch/ksuid";
import type { Named } from "@langwatch/module";
import { z } from "zod";

import type * as connectedModule from "./config/connected.ts";
import { HTTP_METHODS, httpAuthSchema, httpHeaderSchema } from "./config/http.ts";
import {
  codeAgentConfigSchema,
  httpAgentConfigSchema,
  signatureAgentConfigSchema,
  voiceAgentConfigSchema,
  workflowAgentConfigSchema,
} from "./config/index.ts";
import type * as connectedAgentIdentityModule from "./connected-agent.identity.ts";

const httpAgentTestInputSchemaDefinition = z.object({
  projectId: z.string(),
  agentId: z.string().optional(),
  url: z.string().url(),
  method: z.enum(HTTP_METHODS),
  headers: httpHeaderSchema.array().optional(),
  auth: httpAuthSchema.optional(),
  bodyTemplate: z.string(),
  templateVariables: z.record(z.string(), z.json()).optional(),
  outputPath: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
});
export interface HttpAgentTestInputSchema extends Named<
  typeof httpAgentTestInputSchemaDefinition
> {}
export const httpAgentTestInputSchema: HttpAgentTestInputSchema =
  httpAgentTestInputSchemaDefinition;

export type HttpAgentTestInput = z.infer<typeof httpAgentTestInputSchema>;

const createAgentRequestBaseSchema = z.object({
  name: z.string().min(1).max(255),
  workflowId: z.string().optional(),
  copiedFromAgentId: z.string().optional(),
});

const createAgentRequestVariants = [
  z.object({
    ...createAgentRequestBaseSchema.shape,
    type: z.literal("signature"),
    config: signatureAgentConfigSchema,
  }),
  z.object({
    ...createAgentRequestBaseSchema.shape,
    type: z.literal("code"),
    config: codeAgentConfigSchema,
  }),
  z.object({
    ...createAgentRequestBaseSchema.shape,
    type: z.literal("workflow"),
    config: workflowAgentConfigSchema,
  }),
  z.object({
    ...createAgentRequestBaseSchema.shape,
    type: z.literal("http"),
    config: httpAgentConfigSchema,
  }),
  z.object({
    ...createAgentRequestBaseSchema.shape,
    type: z.literal("connected"),
    // Create refuses connected agents (they register), so any config reaches that refusal.
    config: z.record(z.string(), z.unknown()),
  }),
  z.object({
    ...createAgentRequestBaseSchema.shape,
    type: z.literal("voice"),
    config: voiceAgentConfigSchema,
  }),
] as const;

const createAgentRequestSchemaDefinition = z.discriminatedUnion("type", createAgentRequestVariants);
export interface CreateAgentRequestSchema extends Named<
  typeof createAgentRequestSchemaDefinition
> {}
export const createAgentRequestSchema: CreateAgentRequestSchema =
  createAgentRequestSchemaDefinition;

const createAgentCommandBaseSchema = z.object({
  // Minted here, as on main, so the audited args carry the id the history reads by.
  id: z.string().default(() => generate("agent").toString()),
  projectId: z.string(),
});

const createAgentCommandSchemaDefinition = z.discriminatedUnion("type", [
  z.object({
    ...createAgentCommandBaseSchema.shape,
    ...createAgentRequestVariants[0].shape,
  }),
  z.object({
    ...createAgentCommandBaseSchema.shape,
    ...createAgentRequestVariants[1].shape,
  }),
  z.object({
    ...createAgentCommandBaseSchema.shape,
    ...createAgentRequestVariants[2].shape,
  }),
  z.object({
    ...createAgentCommandBaseSchema.shape,
    ...createAgentRequestVariants[3].shape,
  }),
  z.object({
    ...createAgentCommandBaseSchema.shape,
    ...createAgentRequestVariants[4].shape,
  }),
  z.object({
    ...createAgentCommandBaseSchema.shape,
    ...createAgentRequestVariants[5].shape,
  }),
]);
export interface CreateAgentCommandSchema extends Named<
  typeof createAgentCommandSchemaDefinition
> {}
export const createAgentCommandSchema: CreateAgentCommandSchema =
  createAgentCommandSchemaDefinition;

const updateAgentRequestSchemaDefinition = z.object({
  name: z.string().min(1).max(255).optional(),
  type: z.enum(["signature", "code", "workflow", "http", "connected", "voice"]).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  workflowId: z.string().nullable().optional(),
});
export interface UpdateAgentRequestSchema extends Named<
  typeof updateAgentRequestSchemaDefinition
> {}
export const updateAgentRequestSchema: UpdateAgentRequestSchema =
  updateAgentRequestSchemaDefinition;

const updateAgentCommandSchemaDefinition = z.object({
  ...updateAgentRequestSchema.shape,
  id: z.string(),
  projectId: z.string(),
});
export interface UpdateAgentCommandSchema extends Named<
  typeof updateAgentCommandSchemaDefinition
> {}
export const updateAgentCommandSchema: UpdateAgentCommandSchema =
  updateAgentCommandSchemaDefinition;

const archiveAgentCommandSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
});
export interface ArchiveAgentCommandSchema extends Named<
  typeof archiveAgentCommandSchemaDefinition
> {}
export const archiveAgentCommandSchema: ArchiveAgentCommandSchema =
  archiveAgentCommandSchemaDefinition;

/** A copy's row; `workflowId` names the graph copy workflow wrote first for a workflow agent. */
const copyAgentCommandSchemaDefinition = z.object({
  sourceAgentId: z.string(),
  sourceProjectId: z.string(),
  targetProjectId: z.string(),
  newAgentId: z.string().optional(),
  workflowId: z.string().optional(),
});
export interface CopyAgentCommandSchema extends Named<typeof copyAgentCommandSchemaDefinition> {}
export const copyAgentCommandSchema: CopyAgentCommandSchema = copyAgentCommandSchemaDefinition;

export type CreateAgentCommand = z.input<typeof createAgentCommandSchema>;
export type CreateAgentRequest = z.input<typeof createAgentRequestSchema>;
export type UpdateAgentCommand = z.input<typeof updateAgentCommandSchema>;
export type UpdateAgentRequest = z.input<typeof updateAgentRequestSchema>;
export type ArchiveAgentCommand = z.infer<typeof archiveAgentCommandSchema>;
export type CopyAgentCommand = z.infer<typeof copyAgentCommandSchema>;

export type RegisterConnectedAgentInput = {
  id: string;
  projectId: string;
  name: string;
  config: connectedModule.ConnectedAgentConfig;
  identity: connectedAgentIdentityModule.ConnectedAgentIdentity;
};
