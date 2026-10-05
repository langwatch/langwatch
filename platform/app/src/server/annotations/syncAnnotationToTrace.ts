import { createLogger } from "@langwatch/observability";
import { getApp } from "~/server/app-layer/app";

const logger = createLogger("langwatch:annotations:trace-sync");

/**
 * Records an annotation change on its trace. `has:annotation` reads the trace
 * summary's annotation ids, which only these trace commands write: an
 * annotation kept in Postgres alone is listed by the API and invisible to
 * search. `AnnotationService` calls it on every create and delete, whichever
 * API wrote the annotation.
 *
 * Best-effort: Postgres is the source of truth, so a failed sync is logged
 * rather than failing a write that happened. Nothing retries it: an operator
 * running `backfillAnnotationsToClickhouse` repairs a failed add, and nothing
 * repairs a failed remove, since that task only merges ids.
 */
export async function syncAnnotationToTrace({
  action,
  projectId,
  traceId,
  annotationId,
}: {
  action: "add" | "remove";
  projectId: string;
  traceId: string;
  annotationId: string;
}): Promise<void> {
  const command = {
    tenantId: projectId,
    traceId,
    annotationId,
    occurredAt: Date.now(),
  };
  try {
    const traces = getApp().traces;
    if (action === "add") {
      await traces.addAnnotation(command);
    } else {
      await traces.removeAnnotation(command);
    }
  } catch (error) {
    logger.error(
      { error, traceId, projectId, action },
      "Failed to sync annotation to the trace",
    );
  }
}
