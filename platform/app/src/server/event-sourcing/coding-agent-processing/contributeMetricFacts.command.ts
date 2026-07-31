import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { codingAgentSessionEvents } from "./events";
import type { MetricFactsContribution } from "./schema";

/**
 * The trust boundary (ADR-105 decision 7). Session resolution and agent
 * detection already happened in the bridge (`bridge/dispatch.ts`), so this
 * command is a pure function of its input.
 */
export async function contributeMetricFacts(
  input: MetricFactsContribution,
): Promise<readonly EmittedEvent<typeof codingAgentSessionEvents>[]> {
  return [{ type: "metricFactsContributed", data: input }];
}
