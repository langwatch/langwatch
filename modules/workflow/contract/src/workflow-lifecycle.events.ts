import { z } from "zod";

/** The workflow's own lifecycle facts, apart from its runs, which peers react to (§9). */
export const WORKFLOW_CREATED_EVENT_TYPE = "lw.workflow.created" as const;

/** A workflow was created (not copied), how many the project holds counting it, and when. */
export const workflowCreatedEventDataSchema = z.object({
  workflowId: z.string(),
  projectId: z.string(),
  userId: z.string(),
  workflowCount: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
});
export type WorkflowCreatedEventData = z.infer<typeof workflowCreatedEventDataSchema>;
