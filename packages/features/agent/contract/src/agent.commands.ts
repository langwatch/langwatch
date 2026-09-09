import {
  codeAgentConfigSchema,
  connectedAgentConfigSchema,
  httpAgentConfigSchema,
  signatureAgentConfigSchema,
  workflowAgentConfigSchema,
} from "./config/index.ts";
import { z } from "zod";
import { HTTP_METHODS, httpAuthSchema, httpHeaderSchema } from "./config/http.ts";

export const httpAgentTestInputSchema = z.object({
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
    config: connectedAgentConfigSchema,
  }),
] as const;

export const createAgentRequestSchema = z.discriminatedUnion("type", createAgentRequestVariants);

const createAgentCommandBaseSchema = z.object({
  id: z.string().optional(),
  projectId: z.string(),
});

export const createAgentCommandSchema = z.discriminatedUnion("type", [
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
]);

export const updateAgentRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: z.enum(["signature", "code", "workflow", "http", "connected"]).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  workflowId: z.string().nullable().optional(),
});

export const updateAgentCommandSchema = z.object({
  ...updateAgentRequestSchema.shape,
  id: z.string(),
  projectId: z.string(),
});

export const archiveAgentCommandSchema = z.object({
  id: z.string(),
  projectId: z.string(),
});

export const copyAgentCommandSchema = z.object({
  sourceAgentId: z.string(),
  sourceProjectId: z.string(),
  targetProjectId: z.string(),
  actorUserId: z.string(),
  newAgentId: z.string().optional(),
});

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
  config: import("./config/connected.ts").ConnectedAgentConfig;
  identity: import("./connected-agent.identity.ts").ConnectedAgentIdentity;
};
