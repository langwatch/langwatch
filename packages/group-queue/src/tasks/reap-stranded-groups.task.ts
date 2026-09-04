import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";
import type { GroupQueueRedis } from "../dependencies-adapter";

const logger = createLogger("langwatch:task:group-queue-reap-stranded-groups");

/** The dispatcher's own namespace. Overridable because a deployment may run
 *  more than one queue namespace, and a wrong prefix must read the wrong
 *  group's state rather than silently match nothing. */
export const DEFAULT_GROUP_QUEUE_KEY_PREFIX = "{event-sourcing/jobs}:gq:";

/**
 * A group whose jobs nothing will ever dispatch: its job zset exists but the
 * group is in none of the ready, active or blocked sets, so the dispatcher
 * never picks it up and never reclaims it.
 */
export type StrandedGroup = Readonly<{
  groupId: string;
  jobsKey: string;
  dataKey: string;
  jobCount: number;
}>;

export type ReapStrandedGroupsReport = Readonly<{
  mode: "discover" | "apply";
  strandedGroups: number;
  strandedJobs: number;
  deletedGroups: number;
  failedDeletes: number;
  /** Recomputed rather than decremented — see {@link reapStrandedGroups}. */
  totalPendingNow: number | null;
  groups: readonly StrandedGroup[];
}>;

/**
 * Reaps stranded GroupQueue groups (main's `ops/reap-stranded-group-keys.sh`,
 * written for the 2026-05-27 Redis bloat). Discovery only unless `apply`;
 * `minAgeHours` keeps a briefly-stranded live group out of the set.
 */
export async function reapStrandedGroups({
  redis,
  keyPrefix = DEFAULT_GROUP_QUEUE_KEY_PREFIX,
  minAgeHours = 6,
  apply = false,
  signal,
  now = () => Date.now(),
}: {
  redis: GroupQueueRedis;
  keyPrefix?: string;
  minAgeHours?: number;
  apply?: boolean;
  signal?: AbortSignal;
  now?: () => number;
}): Promise<ReapStrandedGroupsReport> {
  const readyKey = `${keyPrefix}ready`;
  const blockedKey = `${keyPrefix}blocked`;
  const totalPendingKey = `${keyPrefix}stats:total-pending`;
  const cutoffMs = now() - minAgeHours * 60 * 60 * 1000;

  const groups: StrandedGroup[] = [];
  for await (const jobsKey of scan({ redis, match: `${keyPrefix}group:*:jobs` })) {
    if (signal?.aborted) break;
    const groupId = jobsKey.slice(`${keyPrefix}group:`.length, -":jobs".length);
    const stranded = await isStranded({
      redis,
      keyPrefix,
      groupId,
      jobsKey,
      readyKey,
      blockedKey,
      cutoffMs,
    });
    if (!stranded) continue;
    groups.push({
      groupId,
      jobsKey,
      dataKey: `${keyPrefix}group:${groupId}:data`,
      jobCount: await redis.zcard(jobsKey),
    });
  }

  const strandedJobs = groups.reduce((total, group) => total + group.jobCount, 0);
  if (!apply) {
    logger.info(
      { strandedGroups: groups.length, strandedJobs, keyPrefix, minAgeHours },
      "discovered stranded groups; re-run with --apply to delete them",
    );
    return {
      mode: "discover",
      strandedGroups: groups.length,
      strandedJobs,
      deletedGroups: 0,
      failedDeletes: 0,
      totalPendingNow: null,
      groups,
    };
  }

  let deletedGroups = 0;
  let failedDeletes = 0;
  for (const group of groups) {
    if (signal?.aborted) break;
    try {
      await redis.del(group.jobsKey, group.dataKey);
      deletedGroups += 1;
    } catch (error) {
      // One transient failure must not abort the sweep: the reaper is safe to
      // re-run, but finishing in a single pass keeps the recount below honest.
      failedDeletes += 1;
      logger.warn({ error, jobsKey: group.jobsKey }, "a stranded group delete failed; continuing");
    }
  }

  // Recomputed from the surviving groups rather than decremented per delete:
  // the counter had already drifted negative during the incident, so a
  // per-group DECRBY would only compound the error.
  let totalPendingNow = 0;
  for await (const jobsKey of scan({ redis, match: `${keyPrefix}group:*:jobs` })) {
    totalPendingNow += await redis.zcard(jobsKey);
  }
  await redis.set(totalPendingKey, String(totalPendingNow));

  logger.info(
    { deletedGroups, failedDeletes, totalPendingNow },
    "reaped stranded groups and recomputed the pending counter",
  );
  return {
    mode: "apply",
    strandedGroups: groups.length,
    strandedJobs,
    deletedGroups,
    failedDeletes,
    totalPendingNow,
    groups,
  };
}

/** All three dispatch-graph memberships absent, and the newest job stale. */
async function isStranded({
  redis,
  keyPrefix,
  groupId,
  jobsKey,
  readyKey,
  blockedKey,
  cutoffMs,
}: {
  redis: GroupQueueRedis;
  keyPrefix: string;
  groupId: string;
  jobsKey: string;
  readyKey: string;
  blockedKey: string;
  cutoffMs: number;
}): Promise<boolean> {
  if ((await redis.zscore(readyKey, groupId)) !== null) return false;
  if ((await redis.exists(`${keyPrefix}group:${groupId}:active`)) === 1) return false;
  if ((await redis.sismember(blockedKey, groupId)) === 1) return false;
  const newest = await redis.zrange(jobsKey, -1, -1, "WITHSCORES");
  const score = Number(newest[1]);
  if (!Number.isFinite(score)) return false;
  return score < cutoffMs;
}

/** `SCAN`, never `KEYS`: this runs against a production Redis holding tens of
 *  thousands of these keys. */
async function* scan({
  redis,
  match,
}: {
  redis: GroupQueueRedis;
  match: string;
}): AsyncGenerator<string> {
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", match, "COUNT", 500);
    cursor = next;
    for (const key of keys) yield key;
  } while (cursor !== "0");
}

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * group-queue-reap-stranded-groups -- --apply --min-age-hours=6`.
 */
export class GroupQueueReapStrandedGroupsTask extends Task {
  readonly name = "group-queue-reap-stranded-groups";
  readonly description =
    "Finds GroupQueue groups no dispatcher can reach and, with --apply, deletes them and recounts pending jobs.";

  private constructor(
    private readonly redis: () => GroupQueueRedis,
    private readonly keyPrefix: string,
  ) {
    super();
  }

  static create({
    redis,
    keyPrefix = DEFAULT_GROUP_QUEUE_KEY_PREFIX,
  }: {
    redis: () => GroupQueueRedis;
    keyPrefix?: string;
  }): GroupQueueReapStrandedGroupsTask {
    return new GroupQueueReapStrandedGroupsTask(redis, keyPrefix);
  }

  async run({ args, signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const minAge = args.find((arg) => arg.startsWith("--min-age-hours="))?.split("=")[1];
    const report = await reapStrandedGroups({
      redis: this.redis(),
      keyPrefix: this.keyPrefix,
      apply: args.includes("--apply"),
      signal,
      ...(minAge === undefined ? {} : { minAgeHours: Number(minAge) }),
    });
    logger.info({ report: { ...report, groups: report.groups.length } }, "reaper finished");
  }
}
