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
 * deploy. Level-triggered by event cursor: a run resumes from the last cursor it completed, so a
 * second run with nothing new changes nothing. Spec: specs/upgrade/projection-replay-step.feature.
 */
export function defineProjectionReplayStep({
  id,
  description,
  lane,
  replayer,
  needsOldWritersGone,
}: {
  id: string;
  description: string;
  lane: string;
  replayer: LaneReplayer;
  needsOldWritersGone?: boolean;
}): MigrationStep {
  return defineMigrationStep({
    id,
    kind: "data",
    mode: "background",
    description,
    ...(needsOldWritersGone === undefined ? {} : { needsOldWritersGone }),
    run: async ({ checkpoint, dryRun, signal }) => {
      const since = resumeCursor({ resumeFrom: checkpoint.resumeFrom, lane });
      if (signal.aborted) return { lane, replayedThrough: since };
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
        const report = { lane, replayedThrough: since, batchesDone: batchNum, totalBatches };
        saving = saving.then(() => checkpoint.save({ report }));
      };
      try {
        const result = await replayer.replayLane({ lane, since, dryRun, onBatchComplete });
        await saving;
        return { ...result };
      } catch (error) {
        await saving.catch(() => undefined);
        throw error;
      }
    },
  });
}

/** The cursor this lane last completed through, or the start of the log. */
function resumeCursor({
  resumeFrom,
  lane,
}: {
  resumeFrom: MigrationStepReport | null;
  lane: string;
}): string {
  const cursor = resumeFrom?.replayedThrough;
  if (resumeFrom?.lane !== lane || typeof cursor !== "string") return PROJECTION_REPLAY_FROM_START;
  return cursor;
}
