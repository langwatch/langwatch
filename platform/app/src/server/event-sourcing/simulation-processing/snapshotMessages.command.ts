import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { simulationRunEvents } from "./events";
import type { MessageSnapshotData } from "./schema";

export async function snapshotMessages(
  input: MessageSnapshotData,
): Promise<readonly EmittedEvent<typeof simulationRunEvents>[]> {
  return [{ type: "messageSnapshot", data: input }];
}
