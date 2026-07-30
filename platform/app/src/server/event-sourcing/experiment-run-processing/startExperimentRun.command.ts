import type { EmittedEvent } from "@langwatch/event-sourcing";
import { experimentRunEvents } from "./events";
import type { RunStartedData } from "./schema";

/** The trust boundary (ADR-105 decision 7): a pure function of its input. */
export async function startExperimentRun(
  input: RunStartedData,
): Promise<readonly EmittedEvent<typeof experimentRunEvents>[]> {
  return [{ type: "started", data: input }];
}
