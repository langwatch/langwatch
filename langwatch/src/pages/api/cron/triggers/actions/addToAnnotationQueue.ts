import { TriggerAction } from "@prisma/client";
import { createOrUpdateQueueItems } from "~/server/api/routers/annotation";
import { prisma } from "~/server/db";
import { captureException } from "~/utils/posthogErrorCapture";
import type { ActionParams, TriggerContext, TriggerData } from "../types";

export const handleAddToAnnotationQueue = async (context: TriggerContext) => {
  const { trigger, triggerData } = context;

  try {
    const fullTrigger = await prisma.trigger.findUnique({
      where: { id: trigger.id, projectId: trigger.projectId },
    });

    const actionParams = fullTrigger?.actionParams as unknown as ActionParams;
    const { annotators, createdByUserId } = actionParams;

    await createQueueItems(triggerData, annotators ?? [], createdByUserId);
  } catch (error) {
    captureException(error, {
      extra: {
        triggerId: trigger.id,
        projectId: trigger.projectId,
        action: TriggerAction.ADD_TO_ANNOTATION_QUEUE,
      },
    });
  }
};

const createQueueItems = async (
  triggerData: TriggerData[],
  annotators: { id: string; name: string }[],
  createdByUserId?: string,
) => {
  // Only process traces (not custom graphs)
  const traceData = triggerData.filter((data) => data.traceId);

  await Promise.all(
    traceData.map((data) =>
      createOrUpdateQueueItems({
        traceIds: [data.traceId!],
        projectId: data.projectId,
        annotators: annotators.map((annotator) => annotator.id),
        userId: createdByUserId ?? "",
        prisma: prisma,
      }),
    ),
  );
};
