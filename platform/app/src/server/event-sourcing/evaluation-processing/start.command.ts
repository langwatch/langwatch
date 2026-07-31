import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { evaluationEvents } from "./events";
import type { EvaluationStartedData } from "./schema";

/** The trust boundary (ADR-105 decision 7): identity and occurredAt are
 * everything a start needs to say, so this is a pure function of its input. */
export async function startEvaluation(
  input: EvaluationStartedData,
): Promise<readonly EmittedEvent<typeof evaluationEvents>[]> {
  return [{ type: "started", data: input }];
}
