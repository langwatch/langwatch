import type { CodeStepId } from "./code-step-ids.generated.ts";
import {
  type MigrationStep,
  type MigrationStepDefinition,
  type MigrationStepReport,
  defineMigrationStep,
} from "./migration-step.ts";

/** The report key holding a replay's cursor; a rollback reopen keeps a report that has it. */
export const PROJECTION_REPLAY_CURSOR = "replayedThrough";

/**
 * The report key holding the instant the lane's first run replayed from: the earliest event time
 * the lane is complete from once the step is done. Kept across resumes and the trailing pass.
 */
export const PROJECTION_REPLAY_SINCE = "replayedSince";

/** The instant a replay step's report says its lane was first replayed from, if it says. */
export function projectionReplaySinceOf(report: MigrationStepReport | null): string | null {
  const since = report?.[PROJECTION_REPLAY_SINCE];
  return typeof since === "string" ? since : null;
}

/** The report keys of an interrupted run: the cursor it completes through, its last done tenant. */
const RUN_CURSOR = "runReplaysThrough";
const LAST_TENANT = "lastTenantDone";

/** The report key holding each aggregate the lane had to page, with its unfinished attempts. */
export const PROJECTION_REPLAY_PAGED = "pagedAggregates";

/** The cursor a lane's first replay starts from: the whole log. */
export const PROJECTION_REPLAY_FROM_START = "1970-01-01T00:00:00Z";

/** Lists the queue claims older images made; every replay drains on that index (ADR-092). */
export const QUEUE_TENANT_CLAIMS_FILL_STEP = "ops:fill-queue-tenant-claims" satisfies CodeStepId;

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
    /** The aggregates the replay had to page, kept in the step's report across runs. */
    paging?: {
      readonly unfinished: ReadonlyMap<string, number>;
      started(input: { key: string }): Promise<void>;
      finished(input: { key: string }): void;
    };
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
 * A background data step filling a projection lane from its owner's log from `since` (default:
 * the start), resuming from its last cursor; `trailingPass` replays once more from that cursor.
 * Specs: specs/upgrade/projection-replay-step.feature and packages/upgrade/specs (`since`).
 */
export function defineProjectionReplayStep({
  id,
  description,
  lane,
  replayer,
  since = PROJECTION_REPLAY_FROM_START,
  trailingPass = false,
  after,
}: {
  id: string;
  description: string;
  lane: string;
  replayer: LaneReplayer;
  /** The instant a first run replays from: aggregates with an event since then refold whole. */
  since?: string;
  /** After the first pass, replay again from the cursor it completed through. */
  trailingPass?: boolean;
  /** The background steps whose work must be in the log before this lane replays it. */
  after?: MigrationStepDefinition["after"];
}): MigrationStep {
  return defineMigrationStep({
    id,
    kind: "data",
    mode: "background",
    description,
    ...declaredOrdering({ after }),
    run: async ({ checkpoint, dryRun, signal }) => {
      let cursor = resumeCursor({ resumeFrom: checkpoint.resumeFrom, lane, since });
      const firstSince = resumeSince({ resumeFrom: checkpoint.resumeFrom, lane, since });
      const origin = { [PROJECTION_REPLAY_SINCE]: firstSince };
      if (signal.aborted) return { lane, replayedThrough: cursor, ...origin };
      const resume = resumeTenants({ resumeFrom: checkpoint.resumeFrom, lane });
      // The cursor stays the last completed one until the run ends; tenants done ride beside it.
      let progress: MigrationStepReport = {
        lane,
        [PROJECTION_REPLAY_CURSOR]: cursor,
        ...origin,
        ...(resume
          ? { [RUN_CURSOR]: resume.replayedThrough, [LAST_TENANT]: resume.afterTenant }
          : {}),
      };
      const paged = resumePaged({ resumeFrom: checkpoint.resumeFrom, lane });
      const withPaged = (report: MigrationStepReport) => withPagedAggregates({ report, paged });
      let saving: Promise<void> = Promise.resolve();
      // `done` and `total` are the step-progress keys the ledger reader shows (STEP-PROGRESS).
      const save = (report: MigrationStepReport) => {
        if (dryRun) return;
        const next = withPaged(report);
        saving = saving.then(() => checkpoint.save({ report: next }));
      };
      const paging = pagingLedger({ paged, save: () => save(progress), saved: () => saving });
      const onBatchComplete = (batch: { batchNum: number; totalBatches: number }) =>
        save({ ...progress, done: batch.batchNum, total: batch.totalBatches });
      const onTenantComplete = (done: { tenantId: string; replayedThrough: string }) => {
        progress = {
          lane,
          [PROJECTION_REPLAY_CURSOR]: cursor,
          ...origin,
          [RUN_CURSOR]: done.replayedThrough,
          [LAST_TENANT]: done.tenantId,
        };
        save(progress);
      };
      try {
        const first = await replayer.replayLane({
          lane,
          since: cursor,
          dryRun,
          signal,
          ...(resume ? { resume } : {}),
          paging,
          onBatchComplete,
          onTenantComplete,
        });
        if (!trailingPass || dryRun || signal.aborted) {
          await saving;
          return withPaged({ ...first, ...origin });
        }
        // The first pass is done: commit its cursor, then replay what became readable after it.
        cursor = first.replayedThrough;
        progress = { lane, [PROJECTION_REPLAY_CURSOR]: cursor, ...origin };
        save(progress);
        const trailing = await replayer.replayLane({
          lane,
          since: cursor,
          dryRun,
          signal,
          paging,
          onBatchComplete,
          onTenantComplete,
        });
        await saving;
        return withPaged({
          ...trailing,
          ...origin,
          aggregatesReplayed: first.aggregatesReplayed + trailing.aggregatesReplayed,
          totalEvents: first.totalEvents + trailing.totalEvents,
        });
      } catch (error) {
        await saving.catch(() => undefined);
        throw error;
      }
    },
  });
}

/**
 * Every replay drains on the queue's claimed-groups index, complete only once older images are
 * gone and their claims are listed (ADR-092), so each step waits for both, whatever it declares.
 */
function declaredOrdering({
  after = [],
}: {
  after: MigrationStepDefinition["after"] | undefined;
}): Pick<MigrationStepDefinition, "needsOldWritersGone" | "after"> {
  return { needsOldWritersGone: true, after: [...after, QUEUE_TENANT_CLAIMS_FILL_STEP] };
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

/** The instant this lane's first run replayed from, kept by every later run of it. */
function resumeSince({
  resumeFrom,
  lane,
  since,
}: {
  resumeFrom: MigrationStepReport | null;
  lane: string;
  since: string;
}): string {
  if (resumeFrom?.lane !== lane) return since;
  return projectionReplaySinceOf(resumeFrom) ?? since;
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

type ReplayPaging = NonNullable<Parameters<LaneReplayer["replayLane"]>[0]["paging"]>;

/** A report carrying the lane's paged aggregates, when it has any. */
function withPagedAggregates({
  report,
  paged,
}: {
  report: MigrationStepReport;
  paged: ReadonlyMap<string, number>;
}): MigrationStepReport {
  if (paged.size === 0) return report;
  return { ...report, [PROJECTION_REPLAY_PAGED]: Object.fromEntries(paged) };
}

/**
 * The paging ledger a replay updates, saving the run's progress on each change. Past its deadline
 * a run's saves are refused, so a paged attempt is counted, and saved, as it starts.
 */
function pagingLedger({
  paged,
  save,
  saved,
}: {
  paged: Map<string, number>;
  save: () => void;
  saved: () => Promise<void>;
}): ReplayPaging {
  return {
    unfinished: paged,
    started: async ({ key }) => {
      paged.set(key, (paged.get(key) ?? 0) + 1);
      save();
      await saved();
    },
    finished: ({ key }) => {
      paged.set(key, 0);
      save();
    },
  };
}

/** The aggregates this lane's earlier runs paged, with their paged attempts not yet finished. */
function resumePaged({
  resumeFrom,
  lane,
}: {
  resumeFrom: MigrationStepReport | null;
  lane: string;
}): Map<string, number> {
  const saved = resumeFrom?.[PROJECTION_REPLAY_PAGED];
  if (resumeFrom?.lane !== lane || typeof saved !== "object" || saved === null) return new Map();
  return new Map(
    Object.entries(saved).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}
