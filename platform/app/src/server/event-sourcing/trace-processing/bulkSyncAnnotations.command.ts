import type { EmittedEvent } from "@langwatch/event-sourcing";
import { traceEvents } from "./events";
import type { AnnotationsBulkSync } from "./schema";

export async function bulkSyncAnnotations(
  input: AnnotationsBulkSync,
): Promise<readonly EmittedEvent<typeof traceEvents>[]> {
  return [{ type: "annotationsBulkSynced", data: input }];
}
