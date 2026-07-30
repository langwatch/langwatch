import type { EmittedEvent } from "@langwatch/event-sourcing";
import { traceEvents } from "./events";
import type { AnnotationRef } from "./schema";

export async function removeAnnotation(
  input: AnnotationRef,
): Promise<readonly EmittedEvent<typeof traceEvents>[]> {
  return [{ type: "annotationRemoved", data: input }];
}
