import type { EmittedEvent } from "@langwatch/event-sourcing";
import { experimentRunEvents } from "./events";
import type { RunCompletedData } from "./schema";

/** The trust boundary (ADR-105 decision 7): a pure function of its input. */
export async function completeExperimentRun(
  input: RunCompletedData,
): Promise<readonly EmittedEvent<typeof experimentRunEvents>[]> {
  return [{ type: "completed", data: input }];
}
