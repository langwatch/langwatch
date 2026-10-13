import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import { compareOrdinal } from "../utils/compareOrdinal.ts";
import { REPLAY_CURSOR_SKEW_MARGIN_MS } from "./replayConstants.ts";
import type { ReplayProjections } from "./replayProjections.ts";
import type { ReplayService } from "./replayService.ts";
import type { BatchCompleteInfo, ProjectionKind, ReplayConfig, ReplayResult } from "./types.ts";

const logger = createLogger("langwatch:event-sourcing:projection-lane-replay");

/** Reached through this file's place in the package index, beside the lane replay it widens. */
export { unionReplayTenants } from "./replayTenantUnion.ts";

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

/** Where an interrupted run stopped: the cursor it completes through and its last done tenant. */
export interface ProjectionLaneReplayResume {
  replayedThrough: string;
  afterTenant: string;
}

/**
 * Replays one named lane (local or peer), one tenant at a time where the log lists its tenants, so
 * the routed member answers each discovery on that tenant's server. The cursor, taken before
 * discovery less the skew margin, is the next run's `since`. Spec: projection-replay-step.feature.
 */
export function projectionLaneReplayer({
  service,
  projections,
}: {
  service: ReplayService;
  projections: ReplayProjections;
}) {
  return {
    async replayLane(input: LaneReplayInput): Promise<ProjectionLaneReplayResult> {
      const { lane, since, dryRun, resume } = input;
      const { kind, eventTypes, selection } = selectLane({ projections, lane });
      const replayedThrough = resume?.replayedThrough ?? cursorBehindClock();
      const tenants = await service.discoverTenants({ eventTypes, since });
      const targets =
        tenants === undefined
          ? [undefined]
          : tenants.filter((t) => !resume || compareOrdinal(t, resume.afterTenant) > 0);
      const totals = await replayTenants({ service, input, selection, targets, replayedThrough });
      return { lane, kind, ...totals, replayedThrough: dryRun ? since : replayedThrough };
    },
  };
}

interface LaneReplayInput {
  lane: string;
  since: string;
  dryRun: boolean;
  signal?: AbortSignal;
  resume?: ProjectionLaneReplayResume;
  onBatchComplete?: (info: BatchCompleteInfo) => void;
  onTenantComplete?: (info: { tenantId: string; replayedThrough: string }) => void;
}

/** Each target in turn (`undefined`: every tenant in one pass), reporting each tenant done. */
async function replayTenants({
  service,
  input: { lane, since, dryRun, signal, onBatchComplete, onTenantComplete },
  selection,
  targets,
  replayedThrough,
}: {
  service: ReplayService;
  input: LaneReplayInput;
  selection: LaneSelection;
  targets: readonly (string | undefined)[];
  replayedThrough: string;
}): Promise<{ aggregatesReplayed: number; totalEvents: number }> {
  const callbacks = {
    ...(onBatchComplete === undefined ? {} : { onBatchComplete }),
    ...(signal === undefined ? {} : { signal }),
  };
  const totals = { aggregatesReplayed: 0, totalEvents: 0 };
  for (const tenantId of targets) {
    signal?.throwIfAborted();
    const tenantIds = tenantId === undefined ? [] : [tenantId];
    const result = await replayUnlessTenantUnknown({
      replay: () => service.replay({ ...selection, tenantIds, since, dryRun }, callbacks),
      lane,
      tenantId,
    });
    if (result.batchErrors > 0) {
      throw new ProjectionLaneReplayFailedError({
        lane,
        batchErrors: result.batchErrors,
        ...(result.firstError === undefined ? {} : { firstError: result.firstError }),
      });
    }
    totals.aggregatesReplayed += result.aggregatesReplayed;
    totals.totalEvents += result.totalEvents;
    if (tenantId !== undefined && !dryRun) onTenantComplete?.({ tenantId, replayedThrough });
  }
  return totals;
}

/** The ClickHouse router's refusal for a tenant it cannot resolve, read structurally by name. */
function isUnknownTenant(error: unknown): boolean {
  return error instanceof Error && error.name === "UnknownTenantError";
}

/**
 * One tenant's replay; a tenant with no known organisation (a route naming an organisation that
 * does not exist, or one since deleted) has nothing to replay, so it is skipped with a warning
 * and nothing is deleted. Spec: specs/upgrade/projection-replay-step.feature.
 */
async function replayUnlessTenantUnknown({
  replay,
  lane,
  tenantId,
}: {
  replay: () => Promise<ReplayResult>;
  lane: string;
  tenantId: string | undefined;
}): Promise<ReplayResult> {
  try {
    return await replay();
  } catch (error) {
    if (tenantId === undefined || !isUnknownTenant(error)) throw error;
    logger.warn({ lane, tenantId }, "Replay skipped a tenant with no known organisation");
    return { aggregatesReplayed: 0, totalEvents: 0, batchErrors: 0 };
  }
}

/** The worker's clock less the skew margin: a later run re-reads what a lagging api stamped. */
function cursorBehindClock(): string {
  return nowInstant().subtract({ milliseconds: REPLAY_CURSOR_SKEW_MARGIN_MS }).toString();
}

export type ProjectionLaneReplayer = ReturnType<typeof projectionLaneReplayer>;

type LaneSelection = Pick<ReplayConfig, "projections" | "mapProjections" | "stateProjections">;

function selectLane({ projections, lane }: { projections: ReplayProjections; lane: string }): {
  kind: ProjectionKind;
  eventTypes: readonly string[];
  selection: LaneSelection;
} {
  const fold = projections.projections.find((p) => p.projectionName === lane);
  if (fold) {
    const eventTypes = fold.definition.eventTypes;
    return { kind: "fold", eventTypes, selection: { projections: [fold] } };
  }
  const map = projections.mapProjections.find((p) => p.projectionName === lane);
  if (map) {
    const eventTypes = map.definition.eventTypes;
    return { kind: "map", eventTypes, selection: { projections: [], mapProjections: [map] } };
  }
  const state = projections.stateProjections.find((p) => p.projectionName === lane);
  if (state) {
    const eventTypes = state.definition.eventTypes;
    return { kind: "state", eventTypes, selection: { projections: [], stateProjections: [state] } };
  }
  throw new ProjectionLaneNotFoundError({ lane });
}
