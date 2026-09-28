/**
 * Once the progress fold has folded an event, its frames go live on the run's channel
 * (ARCHITECTURE §9, 2026-09-28).
 */
import type { SubscriberSpec } from "@langwatch/eventing";

import type { ExperimentRunEventStream } from "../channels/experiment-run-event-stream.channel.ts";
import type { ExperimentRunProgressState } from "../repositories/experiment-run-fold.repository.ts";
import { framesOfEvent } from "../rules/experiment-run-frames.rules.ts";
import type { ExperimentRunProcessingEvent } from "./experiment-run-events.process.ts";

/** A reaction to the run's progress fold. */
export type ExperimentRunProgressSubscriber = {
  name: string;
  spec: SubscriberSpec<ExperimentRunProcessingEvent, ExperimentRunProgressState> & {
    fold: "experimentRunProgress";
  };
};

/** Publishes the frames the fold numbered for this event; a run without a plan streams itself. */
export function createExperimentRunFramesSubscriber({
  stream,
}: {
  stream: ExperimentRunEventStream;
}): ExperimentRunProgressSubscriber {
  return {
    name: "experimentRunFrames",
    spec: {
      fold: "experimentRunProgress",
      runIn: ["worker"],
      when: (_event, { state }) => state.planned,
      handler: async (event, { state }) => {
        if (!state.planned) return;

        for (const { seq, frame } of framesOfEvent({ run: state, eventId: event.id })) {
          await stream.publish({ runId: state.runId, seq, frame });
        }
      },
    },
  };
}
