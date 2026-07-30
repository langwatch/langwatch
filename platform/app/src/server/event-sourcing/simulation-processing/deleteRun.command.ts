import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { simulationRunEvents } from "./events";
import type { RunDeletedData } from "./schema";

export async function deleteRun(
  input: RunDeletedData,
): Promise<readonly EmittedEvent<typeof simulationRunEvents>[]> {
  return [{ type: "deleted", data: input }];
}
