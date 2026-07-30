import type { EmittedEvent } from "@langwatch/event-sourcing";
import { traceEvents } from "./events";
import type { LogContribution } from "./schema";

/** The bridge from `log-processing`: crosses as a command, never a subscription (ADR-098 decision 9). */
export async function recordLogContribution(
  input: LogContribution,
): Promise<readonly EmittedEvent<typeof traceEvents>[]> {
  return [{ type: "logContributed", data: input }];
}
