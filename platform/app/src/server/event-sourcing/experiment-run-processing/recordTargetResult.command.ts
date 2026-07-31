import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { experimentRunEvents } from "./events";
import type { TargetResultData } from "./schema";

/** The trust boundary (ADR-105 decision 7): a pure function of its input. */
export async function recordTargetResult(
  input: TargetResultData,
): Promise<readonly EmittedEvent<typeof experimentRunEvents>[]> {
  return [{ type: "targetResult", data: input }];
}
