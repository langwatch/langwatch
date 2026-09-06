/**
 * State shared between the vitest reporter pipeline and the CI hard-floor
 * timers (see src/test-unit-global-setup.ts and the integration globalSetup).
 *
 * The hard-floor breaks a vitest finalize wedge by force-exiting the shard,
 * and a bare process.exit(0) erases two things the shard already knew:
 *
 *   1. Test failures printed before the wedge. This reporter records "this
 *      shard saw a failure" the moment each result streams in, well before
 *      the finalize path the wedge lives in.
 *   2. Test files that started and never reported a result. A file that
 *      starves the event loop, an infinite render loop or a synchronous spin,
 *      never trips vitest's own testTimeout and so leaves no failed test
 *      behind: the shard reports one file fewer than it ran and looks green
 *      while a real bug sits unrun. This reporter holds every file vitest
 *      hands to a worker until its result comes back, so the floor can name
 *      whatever is still in flight instead of exiting 0 over it.
 *
 * It also keeps the running totals behind those names. A shard that selected,
 * started and reported the same number of files was wedged after finishing its
 * work; one that started fewer files than it selected was cut off part way
 * through, which is a slow shard rather than a hung one and wants a different
 * answer from whoever reads the log.
 *
 * The state lives on globalThis under a string key: the reporter is loaded
 * from the CI CLI (--reporter=./src/test-utils/...) while the globalSetup is
 * loaded by the config, and the two may get separate module instances; the
 * global key makes the handoff instance-proof. Both run in vitest's main
 * process, so no IPC is needed.
 */

const FAILURE_FLAG = "__langwatchShardSawTestFailure";
const MODULE_TALLY = "__langwatchShardTestModuleTally";

interface ModuleTally {
  selected: number;
  shardSelected: number | null;
  started: number;
  reported: number;
  inFlight: Set<string>;
}

type StateCarrier = typeof globalThis & {
  [FAILURE_FLAG]?: boolean;
  [MODULE_TALLY]?: ModuleTally;
};

function markFailure(): void {
  (globalThis as StateCarrier)[FAILURE_FLAG] = true;
}

export function shardSawFailure(): boolean {
  return (globalThis as StateCarrier)[FAILURE_FLAG] === true;
}

function moduleTally(): ModuleTally {
  const carrier = globalThis as StateCarrier;
  carrier[MODULE_TALLY] ??= {
    selected: 0,
    shardSelected: null,
    started: 0,
    reported: 0,
    inFlight: new Set<string>(),
  };
  return carrier[MODULE_TALLY];
}

/**
 * How many files this shard was given, which only the sequencer knows.
 *
 * The reporter is handed the whole suite's file list, before the sequencer
 * splits it, so its own `selected` is the same number on all four shards.
 * Comparing a shard's progress against that says "still had files to start"
 * on every sharded run, whatever the shard was doing.
 *
 * Recorded rather than read back later because the sequencer runs once, in the
 * same process, and nothing else is in a position to say.
 */
export function recordShardSelection(count: number): void {
  moduleTally().shardSelected = count;
}

/**
 * Drops both carriers, for a test driving the reporter directly.
 *
 * It lives beside the keys rather than beside the tests so that renaming one
 * cannot quietly turn the reset into a no-op, which would leave each test
 * inheriting the previous one's tally and make the suite pass or fail on
 * ordering.
 */
export function resetShardState(): void {
  const carrier = globalThis as StateCarrier;
  delete carrier[FAILURE_FLAG];
  delete carrier[MODULE_TALLY];
}

/**
 * How much of the shard's file list actually made it through, and the absolute
 * paths of the files vitest started and never reported a result for, sorted.
 *
 * `unreportedFiles` is empty once a run reaches onTestRunEnd: at that point
 * vitest has declared the run over, and its own accounting rather than this
 * one decides the outcome. The counts are totals for the whole run and stay
 * put, so the floor can still say how far the shard got.
 */
export function shardModuleTally(): {
  selected: number;
  shardSelected: number | null;
  started: number;
  reported: number;
  unreportedFiles: string[];
} {
  const tally = moduleTally();
  return {
    selected: tally.selected,
    shardSelected: tally.shardSelected,
    started: tally.started,
    reported: tally.reported,
    unreportedFiles: [...tally.inFlight].sort(),
  };
}

interface ReportedResult {
  state: string;
}

interface ReportedTestCase {
  result(): ReportedResult;
}

interface ReportedTestModule {
  moduleId: string;
}

export default class ShardFailureReporter {
  /**
   * The file list this shard was handed, before any of it runs.
   *
   * Every count goes back to zero, not just `selected`: the carrier is a
   * global and a second run in the same process shares it, so totals left by
   * the first would accumulate under a fresh `selected` and print lines like
   * "1 selected, 3 started" while hiding the `started < selected` slow-shard
   * diagnostic behind them.
   */
  onTestRunStart(specifications: readonly unknown[]): void {
    const tally = moduleTally();
    tally.selected = specifications.length;
    tally.started = 0;
    tally.reported = 0;
    tally.inFlight.clear();
    // `shardSelected` is deliberately left alone: the sequencer sets it, and
    // the two run in an order vitest does not promise.
  }

  /**
   * Fires per file, right before the worker imports it, so the in-flight set
   * holds what is genuinely running (bounded by the worker count) rather than
   * the whole shard. Entering at queue time rather than at onTestModuleStart
   * is what catches a file that hangs during import, before any test runs.
   *
   * A file already in flight is ignored, so the counter and the set agree on
   * how many files are open.
   */
  onTestModuleQueued(testModule: ReportedTestModule): void {
    const tally = moduleTally();
    if (tally.inFlight.has(testModule.moduleId)) return;
    tally.started += 1;
    tally.inFlight.add(testModule.moduleId);
  }

  /**
   * A fully skipped file, a describe.skip, an env-gated describe.skipIf, or a
   * file of it.todo, still reports here, and so leaves the set exactly the way
   * a passing file does. Skips are never counted as unreported.
   */
  onTestModuleEnd(testModule: ReportedTestModule): void {
    const tally = moduleTally();
    tally.reported += 1;
    tally.inFlight.delete(testModule.moduleId);
  }

  onTestCaseResult(testCase: ReportedTestCase): void {
    if (testCase.result().state === "failed") markFailure();
  }

  onTestRunEnd(
    _modules: readonly unknown[],
    unhandledErrors: readonly unknown[],
    reason: string,
  ): void {
    if (unhandledErrors.length > 0 || reason === "failed") markFailure();
    moduleTally().inFlight.clear();
  }
}
