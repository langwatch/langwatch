import { z } from "zod";
import { agentInputBindingSchema } from "../fields";
import { baseAgentConfigSchema } from "./base";

export const workflowAgentConfigSchema = baseAgentConfigSchema.extend({
  isCustom: z.boolean().optional(),
  workflow_id: z.string().optional(),
  publishedId: z.string().optional(),
  version_id: z.string().optional(),
  versions: z.record(z.string(), z.unknown()).optional(),
  scenarioMappings: z.record(z.string(), agentInputBindingSchema).optional(),
  scenarioOutputField: z.string().optional(),
});

export type WorkflowAgentConfig = z.infer<typeof workflowAgentConfigSchema>;
