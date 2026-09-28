/**
 * What the run manager's intents do once the outbox delivers them: each sends one of the run
 * pipeline's own commands, so the cell runs, or the fact lands, as an event like any other.
 */
import type { IntentExecutor } from "@langwatch/eventing";
import { ExperimentCellLostError } from "@langwatch/experiment-contract";
import { nowInstant } from "@langwatch/time";

import type { ExperimentRunCommandDispatcherService } from "../services/experiment-run-command-dispatcher.service.ts";
import type {
  CompleteRunIntent,
  ExecuteCellIntent,
  FailCellIntent,
} from "./experiment-run-execution.schemas.ts";

type RunCommands = Pick<
  ExperimentRunCommandDispatcherService,
  "executeExperimentCell" | "failExperimentCell" | "completeExperimentRun"
>;

/** A cell the window opened, run by the worker's ExecuteExperimentCell command. */
export function executeCell(commands: RunCommands): IntentExecutor<ExecuteCellIntent> {
  return async (payload, context) => {
    await commands.executeExperimentCell({
      tenantId: context.tenantId,
      occurredAt: nowInstant().epochMilliseconds,
      ...payload,
    });
  };
}

/** A lost cell finishes failed, under the key its own finish would carry (spec section 3). */
export function failLostCell(commands: RunCommands): IntentExecutor<FailCellIntent> {
  return async (payload, context) => {
    await commands.failExperimentCell({
      tenantId: context.tenantId,
      occurredAt: nowInstant().epochMilliseconds,
      ...payload,
      outcome: "failed",
      error: new ExperimentCellLostError().serialize(),
    });
  };
}

/** The run's `completed`, stamped finished or stopped as the manager decided. */
export function completeRun(commands: RunCommands): IntentExecutor<CompleteRunIntent> {
  return async (payload, context) => {
    const at = nowInstant().epochMilliseconds;
    await commands.completeExperimentRun({
      tenantId: context.tenantId,
      occurredAt: at,
      runId: payload.runId,
      experimentId: payload.experimentId,
      outcome: payload.outcome,
      ...(payload.outcome === "finished" ? { finishedAt: at } : { stoppedAt: at }),
    });
  };
}
