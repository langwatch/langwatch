/** Narrow the optimization contract's unknown payloads once at the studio boundary. */
import { z } from "zod";

export const publishedWorkflowSchema = z.object({
  dsl: z.unknown(),
  version: z.string().optional(),
  isComponent: z.boolean().optional(),
  isEvaluator: z.boolean().optional(),
});

export type PublishedWorkflow = z.infer<typeof publishedWorkflowSchema>;

export const publishedComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  isComponent: z.boolean().optional(),
  publishedId: z.string().nullable().optional(),
  versions: z.array(z.object({ id: z.string(), dsl: z.unknown() })),
});

export type PublishedComponent = z.infer<typeof publishedComponentSchema>;

export const publishedComponentsSchema = z.array(publishedComponentSchema);
