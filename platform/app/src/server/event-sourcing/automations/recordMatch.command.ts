import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { automationsEvents, MatchRecordedData } from "./events";

/** The trust boundary (ADR-105 decision 7): a match is already fully decided
 *  by the subscriber that found it, so this command is a pure pass-through. */
export async function recordMatch(
  input: MatchRecordedData,
): Promise<readonly EmittedEvent<typeof automationsEvents>[]> {
  return [{ type: "matchRecorded", data: input }];
}
