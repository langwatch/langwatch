// State shared between vitest reporter and CI hard-floor timers to detect
// test failures and in-flight files that would otherwise be hidden by a wedge.

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

// Count of files assigned to this shard; used to detect partial runs.
export function recordShardSelection(count: number): void {
  moduleTally().shardSelected = count;
}

/**
 * Drops both carriers, for a test driving the reporter directly. Lives
 * beside the keys, not the tests, so renaming one can't quietly turn the
 * reset into a no-op — which would leave tests inheriting a prior tally.
 */
export function resetShardState(): void {
  const carrier = globalThis as StateCarrier;
  delete carrier[FAILURE_FLAG];
  delete carrier[MODULE_TALLY];
}

// Progress through file list and files that started but never reported results.
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
  // Initialize counts for this shard; reset totals to avoid accumulation.
  onTestRunStart(specifications: readonly unknown[]): void {
    const tally = moduleTally();
    tally.selected = specifications.length;
    tally.started = 0;
    tally.reported = 0;
    tally.inFlight.clear();
    // `shardSelected` is deliberately left alone: the sequencer sets it, and
    // the two run in an order vitest does not promise.
  }

  // Track files starting; catching imports that hang before any test runs.
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
