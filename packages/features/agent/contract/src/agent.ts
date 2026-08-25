import { z } from "zod";
import {
  codeAgentConfigSchema,
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

export function linkedWorkflowId(
  agent: Pick<Agent, "workflowId" | "config">,
): string | undefined {
  if (agent.workflowId) return agent.workflowId;
  return (agent.config as { workflow_id?: string }).workflow_id;
}
