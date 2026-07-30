import type { EmittedEvent } from "@langwatch/event-sourcing";
import { evaluationEvents } from "./events";
import type { EvaluationReportedData } from "./schema";

/** The SDK's atomic-report path: the caller already resolved the whole
 * result, so this is a pure function of its input (ADR-105 decision 7). */
export async function reportEvaluation(
  input: EvaluationReportedData,
): Promise<readonly EmittedEvent<typeof evaluationEvents>[]> {
  return [{ type: "reported", data: input }];
}
