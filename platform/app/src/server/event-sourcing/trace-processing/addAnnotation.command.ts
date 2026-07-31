import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { traceEvents } from "./events";
import type { AnnotationRef } from "./schema";

export async function addAnnotation(
  input: AnnotationRef,
): Promise<readonly EmittedEvent<typeof traceEvents>[]> {
  return [{ type: "annotationAdded", data: input }];
}
