import { relative } from "node:path";
import { shardModuleTally, shardSawFailure } from "./shard-failure-reporter";

/**
 * The unit shard's hard floor: what it prints and the code it exits with. A
 * vitest finalize wedge holds a shard open after its last test passes, and a
 * bare exit(0) would stamp a green job over red or unrun tests.
 */

/**
 * A healthy unit shard finishes in ~3 min, so a 4-min floor only fires on a
 * wedge and caps the wasted wall-clock at ~1 min of idle.
 */
const DEFAULT_HARD_FLOOR_MS = 4 * 60 * 1000;

/**
 * How long the shard may stay alive before the floor fires, or null to leave it
 * disarmed. LANGWATCH_UNIT_HARD_FLOOR_MS shortens it and arms it outside CI; a
 * value that is not positive is announced rather than silently dropped.
 */
export function resolveHardFloorMs(): number | null {
  const raw = process.env.LANGWATCH_UNIT_HARD_FLOOR_MS?.trim();
  const override = Number(raw);
  if (Number.isFinite(override) && override > 0) return override;

  if (raw) {
    console.warn(
      `[unit globalSetup] LANGWATCH_UNIT_HARD_FLOOR_MS is "${raw}", which is not a positive number of milliseconds, so it was ignored`,
    );
  }

  return process.env.CI ? DEFAULT_HARD_FLOOR_MS : null;
}

/**
 * How many files the shard was given, said so a sharded run and a whole one both read plainly.
 * The reporter is handed the whole suite before the sequencer splits it, so `selected` is the
 * same on every shard while the shard itself holds a quarter of it.
 */
function describeFileCount({
  selected,
  shardSelected,
}: {
  selected: number;
  shardSelected: number | null | undefined;
}): string {
  if (shardSelected == null) return `${selected} selected`;
  return `${shardSelected} in this shard (of ${selected} selected)`;
}

/**
 * What the floor prints and the code it exits with, given what the shard knew
 * when it fired.
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
    shardSelected?: number | null;
    started: number;
    reported: number;
    unreportedFiles: readonly string[];
  };
}): { exitCode: 0 | 1; lines: string[] } {
  const { selected, shardSelected, started, reported, unreportedFiles } = modules;
  // What this shard was given, which on a sharded run is a quarter or so of
  // `selected`. Without it the counts below compare a shard against the suite.
  const mine = shardSelected ?? selected;
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

  const counted = describeFileCount({ selected, shardSelected });
  const lines = [
    `[unit globalSetup] hard floor reached at ${minutes} min - forcing process.exit(${exitCode}) to release the CI step from a vitest finalize wedge${suffix}`,
    `[unit globalSetup] test files: ${counted}, ${started} started, ${reported} reported a result`,
  ];

  if (started < mine) {
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

/**
 * Arms the floor for a shard, as a vitest `globalSetup`. Unref'd, so a healthy
 * shard exits on its own and the timer only fires on the wedge.
 */
export async function setup(): Promise<void> {
  const hardFloorMs = resolveHardFloorMs();
  if (hardFloorMs === null) return;

  const timer = setTimeout(() => {
    const tally = shardModuleTally();
    const { exitCode, lines } = hardFloorReport({
      hardFloorMs,
      sawFailure: shardSawFailure(),
      modules: {
        ...tally,
        unreportedFiles: tally.unreportedFiles.map((moduleId) => relative(process.cwd(), moduleId)),
      },
    });
    for (const line of lines) console.log(line);
    process.exit(exitCode);
  }, hardFloorMs);
  timer.unref();
}
