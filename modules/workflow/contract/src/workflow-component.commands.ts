import { z } from "zod";
import { studioWorkflowSchema } from "./studio-workflow.ts";

export const executeWorkflowComponentInputSchema = z.object({
  projectId: z.string().min(1),
  workflow: studioWorkflowSchema,
  nodeId: z.string().min(1),
  traceId: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()),
  origin: z.enum(["agent_test", "workflow"]),
});

export type ExecuteWorkflowComponentInput = z.infer<typeof executeWorkflowComponentInputSchema>;
