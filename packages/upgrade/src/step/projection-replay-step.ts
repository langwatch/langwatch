import {
  type MigrationStep,
  type MigrationStepReport,
  defineMigrationStep,
} from "./migration-step.ts";

/** The report key holding a replay's cursor; a rollback reopen keeps a report that has it. */
export const PROJECTION_REPLAY_CURSOR = "replayedThrough";

/** The report keys of an interrupted run: the cursor it completes through, its last done tenant. */
const RUN_CURSOR = "runReplaysThrough";
const LAST_TENANT = "lastTenantDone";

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
    signal?: AbortSignal;
    resume?: { replayedThrough: string; afterTenant: string };
    onBatchComplete?: (info: { batchNum: number; totalBatches: number }) => void;
    onTenantComplete?: (info: { tenantId: string; replayedThrough: string }) => void;
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
      const resume = resumeTenants({ resumeFrom: checkpoint.resumeFrom, lane });
      // The cursor stays the last completed one until the run ends; tenants done ride beside it.
      let progress: MigrationStepReport = {
        lane,
        [PROJECTION_REPLAY_CURSOR]: cursor,
        ...(resume
          ? { [RUN_CURSOR]: resume.replayedThrough, [LAST_TENANT]: resume.afterTenant }
          : {}),
      };
      let saving: Promise<void> = Promise.resolve();
      const save = (report: MigrationStepReport) => {
        if (dryRun) return;
        saving = saving.then(() => checkpoint.save({ report }));
      };
      const onBatchComplete = (batch: { batchNum: number; totalBatches: number }) =>
        save({ ...progress, batchesDone: batch.batchNum, totalBatches: batch.totalBatches });
      const onTenantComplete = (done: { tenantId: string; replayedThrough: string }) => {
        progress = {
          lane,
          [PROJECTION_REPLAY_CURSOR]: cursor,
          [RUN_CURSOR]: done.replayedThrough,
          [LAST_TENANT]: done.tenantId,
        };
        save(progress);
      };
      try {
        const result = await replayer.replayLane({
          lane,
          since: cursor,
          dryRun,
          signal,
          ...(resume ? { resume } : {}),
          onBatchComplete,
          onTenantComplete,
        });
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
  const cursor = resumeFrom?.[PROJECTION_REPLAY_CURSOR];
  if (resumeFrom?.lane !== lane || typeof cursor !== "string") return since;
  return cursor;
}

/** An interrupted run of this lane: the cursor it completes through and the last tenant it did. */
function resumeTenants({
  resumeFrom,
  lane,
}: {
  resumeFrom: MigrationStepReport | null;
  lane: string;
}): { replayedThrough: string; afterTenant: string } | undefined {
  const replayedThrough = resumeFrom?.[RUN_CURSOR];
  const afterTenant = resumeFrom?.[LAST_TENANT];
  if (resumeFrom?.lane !== lane) return undefined;
  if (typeof replayedThrough !== "string" || typeof afterTenant !== "string") return undefined;
  return { replayedThrough, afterTenant };
}
