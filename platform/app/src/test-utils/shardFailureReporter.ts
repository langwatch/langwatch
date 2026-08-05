/**
 * Failure flag shared between the vitest reporter pipeline and the CI
 * hard-floor timers (see src/test-unit-global-setup.ts and the
 * integration globalSetup).
 *
 * The hard-floor breaks a vitest finalize wedge by force-exiting the
 * shard, but a bare process.exit(0) also erases any test failures the
 * shard printed before wedging — CI then reports a green job over red
 * tests. This reporter records "this shard saw a failure" the moment
 * each result streams in, well before the finalize path the wedge
 * lives in, so the floor can preserve the failure in its exit code.
 *
 * The flag lives on globalThis under a string key: the reporter is
 * loaded from the CI CLI (--reporter=./src/test-utils/...) while the
 * globalSetup is loaded by the config, and the two may get separate
 * module instances; the global key makes the handoff instance-proof.
 * Both run in vitest's main process, so no IPC is needed.
 */

const FLAG = "__langwatchShardSawTestFailure";

type FlagCarrier = typeof globalThis & { [FLAG]?: boolean };

function markFailure(): void {
  (globalThis as FlagCarrier)[FLAG] = true;
}

export function shardSawFailure(): boolean {
  return (globalThis as FlagCarrier)[FLAG] === true;
}

interface ReportedResult {
  state: string;
}

interface ReportedTestCase {
  result(): ReportedResult;
}

export default class ShardFailureReporter {
  onTestCaseResult(testCase: ReportedTestCase): void {
    if (testCase.result().state === "failed") markFailure();
  }

  onTestRunEnd(
    _modules: readonly unknown[],
    unhandledErrors: readonly unknown[],
    reason: string,
  ): void {
    if (unhandledErrors.length > 0 || reason === "failed") markFailure();
  }
}
