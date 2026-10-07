/**
 * The replayer a module's `.withMigrations` setup receives (Alex, 2026-10-07, round 12): eventing's
 * lane replayer over the engine this process's eventing member opens for one run. Read at call
 * time, since every pipeline registers only once the last module has installed.
 */
import {
  type ProjectionLaneReplayer,
  projectionLaneReplayer,
  replayProjectionsOf,
} from "@langwatch/eventing";

import type { EventingHost } from "./module-eventing.ts";

/** This process's eventing member opens no replay engine, so no lane can be replayed here. */
export class ProjectionReplayUnavailableError extends Error {
  readonly code = "projection_replay_unavailable";
  readonly lane: string;
  constructor({ lane }: { lane: string }) {
    super(
      `Cannot replay the projection lane "${lane}": this process's eventing member opens no ` +
        "replay engine (it needs the event log and a standalone Redis).",
    );
    this.name = "ProjectionReplayUnavailableError";
    this.lane = lane;
  }
}

/** One lane's replay over the process's own event log; refuses by code where none can run. */
export function processProjectionReplayer({
  eventing,
}: {
  eventing: Pick<EventingHost, "definitions" | "replayEngine"> | undefined;
}): ProjectionLaneReplayer {
  return {
    async replayLane(input) {
      const definitions = eventing?.definitions;
      const engine = definitions === undefined ? undefined : eventing?.replayEngine?.();
      if (definitions === undefined || engine === undefined) {
        throw new ProjectionReplayUnavailableError({ lane: input.lane });
      }
      try {
        return await projectionLaneReplayer({
          service: engine.service,
          projections: replayProjectionsOf(definitions),
        }).replayLane(input);
      } finally {
        await engine.close();
      }
    },
  };
}
