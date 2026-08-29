/**
 * Queueing traces for annotation, for everything that can queue one: the trace
 * table's selection bar, the trace drawer, and the automations that hand traces
 * over on their own.
 *
 * Which of the ids sent actually address a trace this project holds is not
 * Annotation's answer — it lives in trace storage — so it arrives as
 * {@link FindExistingTraceIds} rather than being resolved here.
 */
import type { AnnotationService } from "@langwatch/annotation-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

const logger = createLogger("langwatch:api:annotation");

/**
 * An annotator reference that is neither `queue-<id>` nor `user-<id>`.
 *
 * A handled failure rather than a `TRPCError`: this is a service, and a
 * service that constructs a transport's error decides the wire shape for every
 * transport that will ever call it. The cause is nameable and the caller can
 * fix it, so it carries a stable code and the boundary picks the status — the
 * 400 this has always answered.
 */
export class AnnotationAnnotatorReferenceInvalidError extends HandledError {
  declare readonly code: "annotation_annotator_reference_invalid";

  constructor(annotator: string) {
    super("annotation_annotator_reference_invalid", "Invalid annotator", {
      httpStatus: 400,
      fault: "customer",
      meta: { annotator },
    });
    this.name = "AnnotationAnnotatorReferenceInvalidError";
  }
}

const annotatorReferenceSchema = z.string().transform((annotator, ctx) => {
  if (annotator.startsWith("queue-") && annotator.length > 6) {
    return { type: "queue" as const, id: annotator.slice(6) };
  }
  if (annotator.startsWith("user-") && annotator.length > 5) {
    return { type: "user" as const, id: annotator.slice(5) };
  }
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid annotator" });
  return z.NEVER;
});

type AnnotatorReference = z.infer<typeof annotatorReferenceSchema>;

/** Which of these ids the project holds a trace for. */
export type FindExistingTraceIds = (args: {
  projectId: string;
  traceIds: string[];
}) => Promise<string[]>;

/**
 * The ids worth writing a queue item for, out of what a caller sent. A queue
 * item is a promise that there is something to review, so:
 *   - blank ids address no trace and are dropped;
 *   - a repeated id survives once. The upsert reopens a finished item
 *     (`doneAt: null`), so running it twice for one id in one call would
 *     un-finish work the reviewer had already completed;
 *   - an id no trace answers to is skipped. It would otherwise become an item
 *     the reviewer cannot read, cannot annotate, and cannot get past.
 */
const resolveQueueableTraceIds = async ({
  traceIds,
  projectId,
  findExistingTraceIds,
}: {
  traceIds: string[];
  projectId: string;
  findExistingTraceIds: FindExistingTraceIds;
}): Promise<string[]> => {
  const candidates = [...new Set(traceIds.map((traceId) => traceId.trim()).filter(Boolean))];
  const resolvable = new Set(await findExistingTraceIds({ projectId, traceIds: candidates }));
  const queueable = candidates.filter((traceId) => resolvable.has(traceId));

  if (queueable.length < traceIds.length) {
    logger.info(
      { projectId, sent: traceIds.length, queued: queueable.length },
      "Dropped trace ids that resolve to no trace when queueing for annotation",
    );
  }
  return queueable;
};

/**
 * Queues traces for annotation.
 *
 * An annotator reference that parses as neither `queue-<id>` nor `user-<id>`
 * is a handled failure rather than a plain error, because the caller sent it
 * and the caller can fix it. It carries the 400 this surface has always
 * answered — see {@link AnnotationAnnotatorReferenceInvalidError}.
 *
 * @returns how many ids were queued and how many were skipped (everything sent
 *   that did not become work), so the surface that sent them can say what
 *   actually happened.
 */
export async function createOrUpdateQueueItems({
  traceIds,
  projectId,
  annotators,
  userId,
  annotations,
  findExistingTraceIds,
}: {
  traceIds: string[];
  projectId: string;
  annotators: string[];
  userId: string;
  annotations: AnnotationService;
  findExistingTraceIds: FindExistingTraceIds;
}): Promise<{ created: number; skipped: number }> {
  const parsedAnnotators: AnnotatorReference[] = annotators.map((annotator) => {
    const parsed = annotatorReferenceSchema.safeParse(annotator);
    if (!parsed.success) throw new AnnotationAnnotatorReferenceInvalidError(annotator);
    return parsed.data;
  });
  const queueIds = parsedAnnotators
    .filter((annotator) => annotator.type === "queue")
    .map((annotator) => annotator.id);
  const userIds = parsedAnnotators
    .filter((annotator) => annotator.type === "user")
    .map((annotator) => annotator.id);

  await annotations.assertAnnotatorReferences({ projectId, queueIds, userIds });

  const queueableTraceIds = await resolveQueueableTraceIds({
    traceIds,
    projectId,
    findExistingTraceIds,
  });

  await annotations.createQueueItems({
    projectId,
    traceIds: queueableTraceIds,
    queueIds,
    userIds,
    createdByUserId: userId,
  });

  return {
    created: queueableTraceIds.length,
    skipped: traceIds.length - queueableTraceIds.length,
  };
}
