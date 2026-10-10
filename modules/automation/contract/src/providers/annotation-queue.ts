import type { Named } from "@langwatch/module";
import { z } from "zod";

import type { SharedDef } from "../provider-types.ts";

const annotationQueueActionParamsSchemaDefinition = z.object({
  annotators: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .min(1, "Add at least one annotator."),
  createdByUserId: z.string().min(1).optional(),
});
export interface AnnotationQueueActionParamsSchema extends Named<
  typeof annotationQueueActionParamsSchemaDefinition
> {}
export const annotationQueueActionParamsSchema: AnnotationQueueActionParamsSchema =
  annotationQueueActionParamsSchemaDefinition;
export type AnnotationQueueActionParams = z.infer<typeof annotationQueueActionParamsSchema>;

const definition: SharedDef = {
  action: "ADD_TO_ANNOTATION_QUEUE",
  category: "action",
  label: "Add to annotation queue",
  description: "Queue matched traces for a human to label.",
  actionParamsSchema: annotationQueueActionParamsSchema,
};

export default definition;
