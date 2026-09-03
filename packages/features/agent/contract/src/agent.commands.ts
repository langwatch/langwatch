import {
  codeAgentConfigSchema,
  connectedAgentConfigSchema,
  httpAgentConfigSchema,
  signatureAgentConfigSchema,
  workflowAgentConfigSchema,
} from "./config";
import { z } from "zod";

const createAgentRequestBaseSchema = z.object({
  name: z.string().min(1).max(255),
  workflowId: z.string().optional(),
  copiedFromAgentId: z.string().optional(),
});

const createAgentRequestVariants = [
  createAgentRequestBaseSchema.extend({
    type: z.literal("signature"),
    config: signatureAgentConfigSchema,
  }),
  createAgentRequestBaseSchema.extend({
    type: z.literal("code"),
    config: codeAgentConfigSchema,
  }),
  createAgentRequestBaseSchema.extend({
    type: z.literal("workflow"),
    config: workflowAgentConfigSchema,
  }),
  createAgentRequestBaseSchema.extend({
    type: z.literal("http"),
    config: httpAgentConfigSchema,
  }),
  createAgentRequestBaseSchema.extend({
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
  createAgentCommandBaseSchema.merge(createAgentRequestVariants[0]),
  createAgentCommandBaseSchema.merge(createAgentRequestVariants[1]),
  createAgentCommandBaseSchema.merge(createAgentRequestVariants[2]),
  createAgentCommandBaseSchema.merge(createAgentRequestVariants[3]),
  createAgentCommandBaseSchema.merge(createAgentRequestVariants[4]),
]);

export const updateAgentRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: z.enum(["signature", "code", "workflow", "http", "connected"]).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  workflowId: z.string().nullable().optional(),
});

export const updateAgentCommandSchema = updateAgentRequestSchema.extend({
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
