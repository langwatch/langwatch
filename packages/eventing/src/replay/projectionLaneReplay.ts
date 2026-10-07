import { nowInstant } from "@langwatch/time";

import type { ReplayProjections } from "./replayProjections.ts";
import type { ReplayService } from "./replayService.ts";
import type { BatchCompleteInfo, ProjectionKind, ReplayConfig } from "./types.ts";

/** One lane's replay, as a deploy step reports it; `replayedThrough` is the next run's `since`. */
export interface ProjectionLaneReplayResult {
  lane: string;
  kind: ProjectionKind;
  aggregatesReplayed: number;
  totalEvents: number;
  replayedThrough: string;
}

/** A lane no registered pipeline declares, local or peer; the step names it for its owner. */
export class ProjectionLaneNotFoundError extends Error {
  readonly code = "projection_lane_not_found";
  readonly lane: string;
  constructor({ lane }: { lane: string }) {
    super(`No registered pipeline declares the projection lane "${lane}" (local or peer).`);
    this.name = "ProjectionLaneNotFoundError";
    this.lane = lane;
  }
}

/** A replay whose batches failed: the engine kept its markers, so the next run resumes. */
export class ProjectionLaneReplayFailedError extends Error {
  readonly code = "projection_lane_replay_failed";
  readonly lane: string;
  constructor({
    lane,
    batchErrors,
    firstError,
  }: {
    lane: string;
    batchErrors: number;
    firstError?: string;
  }) {
    super(
      `Replaying "${lane}" failed in ${batchErrors} batch(es): ${firstError ?? "unknown error"}`,
    );
    this.name = "ProjectionLaneReplayFailedError";
    this.lane = lane;
  }
}

/**
 * Replays one named lane (local or peer) from its owner's log; the engine pauses the lane's live
 * delivery per batch and resumes it. `replayedThrough`, taken before discovery, is the `since` a
 * later run passes back. Spec: specs/upgrade/projection-replay-step.feature.
 */
export function projectionLaneReplayer({
  service,
  projections,
}: {
  service: ReplayService;
  projections: ReplayProjections;
}) {
  return {
    async replayLane({
      lane,
      since,
      dryRun,
      onBatchComplete,
    }: {
      lane: string;
      since: string;
      dryRun: boolean;
      onBatchComplete?: (info: BatchCompleteInfo) => void;
    }): Promise<ProjectionLaneReplayResult> {
      const { kind, selection } = selectLane({ projections, lane });
      const replayedThrough = nowInstant().toString();
      const result = await service.replay(
        { ...selection, tenantIds: [], since, dryRun },
        onBatchComplete ? { onBatchComplete } : undefined,
      );
      if (result.batchErrors > 0) {
        throw new ProjectionLaneReplayFailedError({
          lane,
          batchErrors: result.batchErrors,
          ...(result.firstError === undefined ? {} : { firstError: result.firstError }),
        });
      }
      return {
        lane,
        kind,
        aggregatesReplayed: result.aggregatesReplayed,
        totalEvents: result.totalEvents,
        replayedThrough: dryRun ? since : replayedThrough,
      };
    },
  };
}

export type ProjectionLaneReplayer = ReturnType<typeof projectionLaneReplayer>;

function selectLane({ projections, lane }: { projections: ReplayProjections; lane: string }): {
  kind: ProjectionKind;
  selection: Pick<ReplayConfig, "projections" | "mapProjections" | "stateProjections">;
} {
  const fold = projections.projections.find((p) => p.projectionName === lane);
  if (fold) return { kind: "fold", selection: { projections: [fold] } };
  const map = projections.mapProjections.find((p) => p.projectionName === lane);
  if (map) return { kind: "map", selection: { projections: [], mapProjections: [map] } };
  const state = projections.stateProjections.find((p) => p.projectionName === lane);
  if (state) return { kind: "state", selection: { projections: [], stateProjections: [state] } };
  throw new ProjectionLaneNotFoundError({ lane });
}
