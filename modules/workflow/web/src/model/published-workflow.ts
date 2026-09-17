/**
 * `optimization.getPublishedWorkflow` and `optimization.getComponents` answer
 * `unknown` by contract - the comment on the contract member says naming a
 * shape there would narrow what the studio is handed. The studio still reads
 * specific fields off both answers, so this is that narrowing, done once
 * here at the point of use instead of assumed at every call site.
 */
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
