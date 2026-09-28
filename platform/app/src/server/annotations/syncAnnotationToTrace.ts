import { createLogger } from "@langwatch/observability";
import { getApp } from "~/server/app-layer/app";

const logger = createLogger("langwatch:annotations:trace-sync");

/**
 * Records an annotation change on its trace. `has:annotation` reads the trace
 * summary's annotation ids, which only these trace commands write: an
 * annotation kept in Postgres alone is listed by the API and invisible to
 * search. Every path that creates or deletes an annotation — the app's router
 * and the REST API — goes through here.
 *
 * Best-effort: Postgres is the source of truth, so a failed sync is logged and
 * the backfill task reconciles it, rather than failing a write that happened.
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
