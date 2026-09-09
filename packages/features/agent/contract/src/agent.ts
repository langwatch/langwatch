import { z } from "zod";
import {
  codeAgentConfigSchema,
  connectedAgentConfigSchema,
  httpAgentConfigSchema,
  signatureAgentConfigSchema,
  workflowAgentConfigSchema,
} from "./config/index.ts";
import { fieldSchema } from "./fields.ts";

export const agentIdSchema = z.string().brand<"AgentId">();

const agentRecordSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  workflowId: z.string().nullable(),
  copiedFromAgentId: z.string().nullable(),
  archivedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  copyCount: z.number().int().nonnegative().optional(),
  /**
   * Connected agents (ADR-128), all nullable because only a connected agent
   * carries them: the environment the SDK resolved, the owner of a personal
   * development agent, the host a project key registered from, the identity
   * the SDK upserts by, and the last time an instance of it was seen.
   */
  environment: z.string().nullable().optional(),
  ownerUserId: z.string().nullable().optional(),
  hostLabel: z.string().nullable().optional(),
  /** What the SDK upserts by, unique within the project. */
  identityKey: z.string().nullable().optional(),
  lastSeenAt: z.date().nullable().optional(),
});

const agentViewRecordSchema = agentRecordSchema.pick({
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
});

export const agentSchema = z.discriminatedUnion("type", [
  z.object({
    ...agentRecordSchema.shape,
    type: z.literal("signature"),
    config: signatureAgentConfigSchema,
  }),
  z.object({
    ...agentRecordSchema.shape,
    type: z.literal("code"),
    config: codeAgentConfigSchema,
  }),
  z.object({
    ...agentRecordSchema.shape,
    type: z.literal("workflow"),
    config: workflowAgentConfigSchema,
  }),
  z.object({
    ...agentRecordSchema.shape,
    type: z.literal("http"),
    config: httpAgentConfigSchema,
  }),
  z.object({
    ...agentRecordSchema.shape,
    type: z.literal("connected"),
    config: connectedAgentConfigSchema,
  }),
]);

export const agentViewSchema = z.discriminatedUnion("type", [
  z.object({
    ...agentViewRecordSchema.shape,
    type: z.literal("signature"),
    config: signatureAgentConfigSchema,
  }),
  z.object({
    ...agentViewRecordSchema.shape,
    type: z.literal("code"),
    config: codeAgentConfigSchema,
  }),
  z.object({
    ...agentViewRecordSchema.shape,
    type: z.literal("workflow"),
    config: workflowAgentConfigSchema,
  }),
  z.object({
    ...agentViewRecordSchema.shape,
    type: z.literal("http"),
    config: httpAgentConfigSchema,
  }),
  z.object({
    ...agentViewRecordSchema.shape,
    type: z.literal("connected"),
    config: connectedAgentConfigSchema,
  }),
]);

export const agentFieldsSchema = z.object({
  inputFields: z.array(fieldSchema),
  outputFields: z.array(fieldSchema),
  fieldsResolved: z.boolean(),
});

export const agentWithFieldsSchema = z.intersection(agentSchema, agentFieldsSchema);

export type AgentId = z.infer<typeof agentIdSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type AgentView = z.infer<typeof agentViewSchema>;
export type AgentFields = z.infer<typeof agentFieldsSchema>;
export type AgentWithFields = z.infer<typeof agentWithFieldsSchema>;

/** Includes the copy count displayed by list consumers. */
export type TypedAgent = Agent & {
  _count?: { copiedAgents: number };
};

export function linkedWorkflowId(agent: Pick<Agent, "workflowId" | "config">): string | undefined {
  if (agent.workflowId) return agent.workflowId;
  return (agent.config as { workflow_id?: string }).workflow_id;
}
