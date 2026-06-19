import { TriggerAction } from "@prisma/client";
import { z } from "zod";
import type { SharedDef } from "../../types";

export const annotationQueueActionParamsSchema = z.object({
  annotators: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .min(1, "Add at least one annotator."),
  // `createdByUserId` is intentionally absent: the upsert/create routes stamp
  // it from the authenticated session (`ctx.session.user.id`). Accepting it
  // from the client would let a caller attribute queue items to another user.
});

export type AnnotationQueueActionParams = z.infer<
  typeof annotationQueueActionParamsSchema
>;

const def: SharedDef = {
  action: TriggerAction.ADD_TO_ANNOTATION_QUEUE,
  category: "action",
  label: "Add to annotation queue",
  description: "Queue matched traces for a human to label.",
  actionParamsSchema: annotationQueueActionParamsSchema,
};

export default def;
