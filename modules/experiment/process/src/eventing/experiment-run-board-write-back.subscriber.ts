import { EXPERIMENT_RUN_EVENT_TYPES } from "../rules/experiment-run-event-types.rules.ts";
import type { ExperimentRunBoardWriteBackService } from "../services/experiment-run-board-write-back.service.ts";
import type { ExperimentRunProgressSubscriber } from "./experiment-run-frames.subscriber.ts";

/** Writes an ended run's cells to the board. */
export function createExperimentRunBoardWriteBackSubscriber({
  boardWriteBack,
}: {
  boardWriteBack: ExperimentRunBoardWriteBackService;
}): ExperimentRunProgressSubscriber {
  return {
    name: "experimentRunBoardWriteBack",
    spec: {
      fold: "experimentRunProgress",
      runIn: ["worker"],
      events: [EXPERIMENT_RUN_EVENT_TYPES.COMPLETED],
      when: (_event, { state }) => state.persistResults,
      handler: (_event, { aggregateId, state }) =>
        boardWriteBack.writeBack({ runKey: aggregateId, progress: state }),
    },
  };
}
