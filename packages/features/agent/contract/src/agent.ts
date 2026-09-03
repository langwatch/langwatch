import { z } from "zod";
import {
  codeAgentConfigSchema,
  connectedAgentConfigSchema,
  httpAgentConfigSchema,
  signatureAgentConfigSchema,
  workflowAgentConfigSchema,
} from "./config";
import { fieldSchema } from "./fields";

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
  agentRecordSchema.extend({
    type: z.literal("signature"),
    config: signatureAgentConfigSchema,
  }),
  agentRecordSchema.extend({
    type: z.literal("code"),
    config: codeAgentConfigSchema,
  }),
  agentRecordSchema.extend({
    type: z.literal("workflow"),
    config: workflowAgentConfigSchema,
  }),
  agentRecordSchema.extend({
    type: z.literal("http"),
    config: httpAgentConfigSchema,
  }),
  agentRecordSchema.extend({
    type: z.literal("connected"),
    config: connectedAgentConfigSchema,
  }),
]);

export const agentViewSchema = z.discriminatedUnion("type", [
  agentViewRecordSchema.extend({
    type: z.literal("signature"),
    config: signatureAgentConfigSchema,
  }),
  agentViewRecordSchema.extend({
    type: z.literal("code"),
    config: codeAgentConfigSchema,
  }),
  agentViewRecordSchema.extend({
    type: z.literal("workflow"),
    config: workflowAgentConfigSchema,
  }),
  agentViewRecordSchema.extend({
    type: z.literal("http"),
    config: httpAgentConfigSchema,
  }),
  agentViewRecordSchema.extend({
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

/**
 * An agent with its config already parsed into the shape its type declares,
 * plus the replica count the agents page reads.
 *
 * The name the platform has always used for a read agent. It is {@link Agent}
 * itself now — the discriminated union parses the config — with the one extra
 * field a list read adds, so the two are the same value and neither reader has
 * to know which one it was handed.
 */
export type TypedAgent = Agent & {
  _count?: { copiedAgents: number };
};

export function linkedWorkflowId(agent: Pick<Agent, "workflowId" | "config">): string | undefined {
  if (agent.workflowId) return agent.workflowId;
  return (agent.config as { workflow_id?: string }).workflow_id;
}
