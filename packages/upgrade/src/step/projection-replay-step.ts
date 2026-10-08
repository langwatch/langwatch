import {
  type MigrationStep,
  type MigrationStepReport,
  defineMigrationStep,
} from "./migration-step.ts";

/** The cursor a lane's first replay starts from: the whole log. */
export const PROJECTION_REPLAY_FROM_START = "1970-01-01T00:00:00Z";

/**
 * The replay a step drives, injected (record: a framework package takes module values by
 * injection): eventing's `projectionLaneReplayer` satisfies it without either package naming
 * the other. `replayedThrough` is the cursor the next run passes back as `since`.
 */
export interface LaneReplayer {
  replayLane(input: {
    lane: string;
    since: string;
    dryRun: boolean;
    onBatchComplete?: (info: { batchNum: number; totalBatches: number }) => void;
  }): Promise<{
    lane: string;
    kind: string;
    aggregatesReplayed: number;
    totalEvents: number;
    replayedThrough: string;
  }>;
}

/**
 * A background data step that fills a projection lane (local or peer) from its owner's log at
 * deploy from `since` (default: the start), resuming from the last cursor it completed. Specs:
 * specs/upgrade/projection-replay-step.feature and packages/upgrade/specs (its `since` scenarios).
 */
export function defineProjectionReplayStep({
  id,
  description,
  lane,
  replayer,
  since = PROJECTION_REPLAY_FROM_START,
  needsOldWritersGone,
}: {
  id: string;
  description: string;
  lane: string;
  replayer: LaneReplayer;
  /** The instant a first run replays from: aggregates with an event since then refold whole. */
  since?: string;
  needsOldWritersGone?: boolean;
}): MigrationStep {
  return defineMigrationStep({
    id,
    kind: "data",
    mode: "background",
    description,
    ...(needsOldWritersGone === undefined ? {} : { needsOldWritersGone }),
    run: async ({ checkpoint, dryRun, signal }) => {
      const cursor = resumeCursor({ resumeFrom: checkpoint.resumeFrom, lane, since });
      if (signal.aborted) return { lane, replayedThrough: cursor };
      let saving: Promise<void> = Promise.resolve();
      const onBatchComplete = ({
        batchNum,
        totalBatches,
      }: {
        batchNum: number;
        totalBatches: number;
      }) => {
        // Saving renews the lease; the cursor stays the last completed one until the run ends.
        if (dryRun) return;
        const report = { lane, replayedThrough: cursor, batchesDone: batchNum, totalBatches };
        saving = saving.then(() => checkpoint.save({ report }));
      };
      try {
        const result = await replayer.replayLane({ lane, since: cursor, dryRun, onBatchComplete });
        await saving;
        return { ...result };
      } catch (error) {
        await saving.catch(() => undefined);
        throw error;
      }
    },
  });
}

/** The cursor this lane last completed through, or the step's first-run instant. */
function resumeCursor({
  resumeFrom,
  lane,
  since,
}: {
  resumeFrom: MigrationStepReport | null;
  lane: string;
  since: string;
}): string {
  const cursor = resumeFrom?.replayedThrough;
  if (resumeFrom?.lane !== lane || typeof cursor !== "string") return since;
  return cursor;
}
