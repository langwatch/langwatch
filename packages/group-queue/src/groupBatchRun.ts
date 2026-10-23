/** What a cross-group run does with its groups; the descent itself is {@link runGroupBatch}. */
interface GroupBatchSteps<Job> {
  /** One call over every group in `set`; `isContinuation` names groups an earlier call carried. */
  runAll: (set: readonly Job[], isContinuation: (job: Job) => boolean) => Promise<void>;
  /** The group alone, through its own path. */
  runOne: (job: Job, isContinuation: boolean) => Promise<void>;
  succeed: (set: readonly Job[]) => Promise<void>;
  fail: (job: Job, error: unknown) => Promise<void>;
  /** False for shared overload: the whole call backs off instead of splitting. */
  splitsOnFailure: (error: unknown) => boolean;
  onSplit?: (input: { size: number; splitAt: number; error: unknown }) => void;
}

/**
 * Runs claimed groups as one call and narrows a failure to whole groups by halving, in sequence
 * (ADR-090 lifted to groups; specs/cross-group-batch.feature). A healthy half completes at once; a
 * group left alone runs its own path. Shared overload backs every group off, unsplit.
 */
export async function runGroupBatch<Job>({
  jobs,
  ...steps
}: GroupBatchSteps<Job> & { jobs: readonly Job[] }): Promise<void> {
  // A call that threw may still have written, so a later call marks its groups continuations.
  await runSet({ set: jobs, steps, carried: new Set<Job>() });
}

async function runSet<Job>({
  set,
  steps,
  carried,
}: {
  set: readonly Job[];
  steps: GroupBatchSteps<Job>;
  carried: Set<Job>;
}): Promise<void> {
  const [only] = set;
  if (only === undefined) return;
  if (set.length === 1) return runAlone({ job: only, steps, carried });

  const failure = await attempt(() => steps.runAll(set, (job) => carried.has(job)));
  for (const job of set) carried.add(job);
  if (!failure) return steps.succeed(set);
  if (!steps.splitsOnFailure(failure.error)) {
    await Promise.all(set.map((job) => steps.fail(job, failure.error)));
    return;
  }
  const splitAt = Math.ceil(set.length / 2);
  steps.onSplit?.({ size: set.length, splitAt, error: failure.error });
  await runSet({ set: set.slice(0, splitAt), steps, carried });
  await runSet({ set: set.slice(splitAt), steps, carried });
}

async function runAlone<Job>({
  job,
  steps,
  carried,
}: {
  job: Job;
  steps: GroupBatchSteps<Job>;
  carried: ReadonlySet<Job>;
}): Promise<void> {
  const failure = await attempt(() => steps.runOne(job, carried.has(job)));
  if (failure) return steps.fail(job, failure.error);
  return steps.succeed([job]);
}

/** The call's failure, or none when it returned. */
async function attempt(run: () => Promise<void>): Promise<{ error: unknown } | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return { error };
  }
}
