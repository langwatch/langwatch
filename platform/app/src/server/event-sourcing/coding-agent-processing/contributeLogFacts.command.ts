import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { codingAgentSessionEvents } from "./events";
import type { LogFactsContribution } from "./schema";

/**
 * The trust boundary (ADR-105 decision 7). Session resolution and agent
 * detection already happened in the bridge (`bridge/dispatch.ts`), so this
 * command is a pure function of its input.
 */
export async function contributeLogFacts(
  input: LogFactsContribution,
): Promise<readonly EmittedEvent<typeof codingAgentSessionEvents>[]> {
  return [{ type: "logFactsContributed", data: input }];
}
