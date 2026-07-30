import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { simulationRunEvents } from "./events";
import type { RunQueuedData } from "./schema";

/** The run was scheduled. Pure: the descriptor and batch total already arrive
 * decided on the input (ADR-105 decision 7). */
export async function queueRun(
  input: RunQueuedData,
): Promise<readonly EmittedEvent<typeof simulationRunEvents>[]> {
  return [{ type: "queued", data: input }];
}
