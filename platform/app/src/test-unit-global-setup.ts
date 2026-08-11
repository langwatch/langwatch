/**
 * Global setup for the UNIT test config (vitest.config.ts).
 *
 * This file exists solely to mirror the hard-floor that already lives in the
 * integration globalSetup (see
 * src/server/event-sourcing/__tests__/integration/globalSetup.ts). Unit tests
 * need no containers or other setup, so the hard-floor is the only thing here.
 *
 * Why a hard-floor on unit too: `langwatch-app-ci` runs `test-unit` (4 shards)
 * and `test-integration` (6 shards). A vitest finalize wedge, diagnosed at
 * length as living in vitest's own shard/reporter finalize path and NOT an
 * application handle leak, makes a *random* shard hang after its last test
 * passes, until the job timeout cap. Integration shards already survive this
 * via the hard-floor in their globalSetup; unit shards had no globalSetup at
 * all, so when the wedge lands on a unit shard the step runs to the 25-min job
 * timeout, gets cancelled, and fails the `langwatch-app-complete` required
 * check (observed cancelling app-ci repeatedly). Extending the same accepted
 * mask to unit lets a wedged unit shard force-exit and unblock the check.
 */
import { relative } from "node:path";

import {
  shardModuleTally,
  shardSawFailure,
} from "./test-utils/shardFailureReporter";

/**
 * A healthy unit shard finishes in ~3 min, so a 4-min floor only fires on a
 * wedge and caps the wasted wall-clock at ~1 min of idle.
 */
const DEFAULT_HARD_FLOOR_MS = 4 * 60 * 1000;

/**
 * How long the shard may stay alive before the floor fires, or null to leave
 * it disarmed. LANGWATCH_UNIT_HARD_FLOOR_MS both shortens the floor and arms
 * it outside CI, which is how the exit path is exercised on a laptop: `CI=1`
 * would also flip pool sizing, worker memory, and, in the integration config,
 * testcontainers.
 *
 * A value that is not a positive number is announced rather than dropped. It
 * leaves the floor disarmed outside CI and back on the default inside it,
 * which looks exactly like the variable working, so the one line here is all
 * the signal a typo ever gets.
 */
export function resolveHardFloorMs(): number | null {
  const raw = process.env.LANGWATCH_UNIT_HARD_FLOOR_MS?.trim();
  const override = Number(raw);
  if (Number.isFinite(override) && override > 0) return override;

  if (raw) {
    // eslint-disable-next-line no-console
    console.warn(
      `[unit globalSetup] LANGWATCH_UNIT_HARD_FLOOR_MS is "${raw}", which is not a positive number of milliseconds, so it was ignored`,
    );
  }

  return process.env.CI ? DEFAULT_HARD_FLOOR_MS : null;
}

/**
 * What the floor prints and the code it exits with, given what the shard knew
 * when it fired. Split out from the timer so the exit contract can be asserted
 * without wedging a real run.
 */
export function hardFloorReport({
  hardFloorMs,
  sawFailure,
  modules,
}: {
  hardFloorMs: number;
  sawFailure: boolean;
  modules: {
    selected: number;
    started: number;
    reported: number;
    unreportedFiles: readonly string[];
  };
}): { exitCode: 0 | 1; lines: string[] } {
  const { selected, started, reported, unreportedFiles } = modules;
  const exitCode = sawFailure || unreportedFiles.length > 0 ? 1 : 0;
  const minutes = Number((hardFloorMs / 60_000).toFixed(2));

  const causes: string[] = [];
  if (sawFailure) causes.push("failures were reported before the wedge");
  if (unreportedFiles.length > 0) {
    causes.push(
      `${unreportedFiles.length} test ${unreportedFiles.length === 1 ? "file" : "files"} started and never reported a result`,
    );
  }
  const suffix = causes.length > 0 ? ` (${causes.join(", and ")})` : "";

  const lines = [
    `[unit globalSetup] hard floor reached at ${minutes} min - forcing process.exit(${exitCode}) to release the CI step from a vitest finalize wedge${suffix}`,
    `[unit globalSetup] test files: ${selected} selected, ${started} started, ${reported} reported a result`,
  ];

  if (started < selected) {
    lines.push(
      "[unit globalSetup] the shard still had files to start, so the floor cut a run that was working rather than one that was wedged. Read that as a shard too slow for the floor, not as a hang.",
    );
  }

  if (unreportedFiles.length > 0) {
    lines.push(
      "[unit globalSetup] these test files never completed, so the tests in them did not run and this shard is red rather than green:",
      ...unreportedFiles.map((file) => `[unit globalSetup]   ${file}`),
      "[unit globalSetup] a file that starves the event loop, an infinite render loop or a synchronous spin, never trips vitest's own testTimeout, so it leaves no failed test behind. Run each file on its own with `pnpm test:unit run <file>` to see where it hangs.",
    );
  }

  return { exitCode, lines };
}

export async function setup(): Promise<void> {
  // Hard floor: a vitest finalize wedge can reproducibly hang a CI shard after
  // the last test of the last file passes. Every diagnostic the team has run
  // (handle dumps, --no-coverage, --no-json-reporter, pool=threads vs
  // pool=forks) shows the worker reaches steady state with no application
  // handles open, then the vitest main process sits idle for the full job
  // timeout cap. The wedge appears to be in vitest's own shard / reporter
  // finalize path and we cannot fix it from inside a test. Schedule a hard
  // process.exit so the step at least completes and the rest of the
  // langwatch-app-complete required check unblocks. Unref'd so a healthy
  // shard exits immediately on its own; the timer only fires on the wedge.
  // Mirrors the integration globalSetup hard-floor; unit shards otherwise lack
  // one.
  //
  // The exit code preserves what the shard already knew, because the wedge
  // also fires over a shard that never got a clean result, and a bare exit(0)
  // there stamps a green job over red or unrun tests. ShardFailureReporter
  // (wired via --reporter in the CI step) records both as results stream:
  // any failed test, and any file vitest started that never reported back.
  const hardFloorMs = resolveHardFloorMs();
  if (hardFloorMs === null) return;

  const timer = setTimeout(() => {
    const tally = shardModuleTally();
    const { exitCode, lines } = hardFloorReport({
      hardFloorMs,
      sawFailure: shardSawFailure(),
      modules: {
        ...tally,
        unreportedFiles: tally.unreportedFiles.map((moduleId) =>
          relative(process.cwd(), moduleId),
        ),
      },
    });
    for (const line of lines) {
      // eslint-disable-next-line no-console
      console.log(line);
    }
    process.exit(exitCode);
  }, hardFloorMs);
  timer.unref();
}
