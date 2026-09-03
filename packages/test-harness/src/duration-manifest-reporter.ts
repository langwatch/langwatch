/**
 * Records how long each test file took, so the shard sequencer can weigh by
 * measured cost instead of by file size.
 *
 * Written by a scheduled full-suite run on main rather than by every CI run,
 * for the reason in shardWeights.ts: the shards must all read the SAME weights
 * or they disagree about the split, and the only artifact they are all
 * guaranteed to share is the one that came out of the checkout. A run that
 * writes the manifest and a run that reads it are therefore deliberately
 * different runs.
 *
 * WRITES A DELTA, NOT A MANIFEST, and to its own file. Each shard emits only
 * the files IT measured, and the aggregation overlays every shard's delta onto
 * the committed manifest.
 *
 * The obvious alternative — have each shard merge its measurements over the
 * committed manifest and emit the whole thing — is wrong in a way that is easy
 * to miss. Every shard's artifact would then carry the full baseline, so for a
 * file measured by shard A, A's artifact holds the NEW value while every other
 * shard's holds the OLD one. A `jq -s add` lets the last artifact win, so
 * whether the fresh measurement survives comes down to the order `find` happened
 * to list the artifacts in. Deltas do not overlap — the lanes partition the
 * files and a lane's shards partition its own — so their union is
 * order-independent, and the baseline is applied once, underneath.
 *
 * Its own file, because a manifest is a COMMITTED artifact: writing a partial
 * one over `vitest.durations.json` would silently delete the weights for every
 * file this run did not execute, which is exactly what a developer running one
 * lane locally would do.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Reporter, TestModule } from "vitest/node";

import type { DurationManifest } from "./shard-weights";

export interface DurationManifestReporterOptions {
  /** Where the manifest lives. Paths inside it are relative to its directory. */
  manifestPath?: string;
  /** Paths in the manifest are relative to this. Defaults to the manifest's directory. */
  root?: string;
}

/**
 * Where the manifest lives when nobody says otherwise.
 *
 * Both halves matter. CI adds this reporter as a bare
 * `--reporter=./src/test-utils/durationManifestReporter.ts`, and vitest
 * constructs a reporter named that way with NO arguments — so a required option
 * here would throw on a path that only runs on a dispatched refresh, which is
 * the least-exercised path there is. And the sequencer resolves the manifest
 * against the app root, so a default that lands anywhere else would be written
 * faithfully and never read.
 */
const DEFAULT_DELTA = "vitest.durations.delta.json";

/**
 * Fold this run's timings into whatever the manifest already holds.
 *
 * Exported separately from the reporter so the merge is testable without
 * driving a vitest run: the merge is where the interesting decisions are, and
 * a reporter lifecycle is not the place to discover them.
 */
export function mergeDurations({
  existing,
  measured,
}: {
  existing: DurationManifest;
  measured: DurationManifest;
}): DurationManifest {
  const merged: DurationManifest = { ...existing, ...measured };
  // Sorted so a refresh produces a minimal, readable diff rather than a
  // reshuffle of a thousand lines whenever key order happens to change.
  return Object.fromEntries(
    Object.keys(merged)
      .sort()
      .map((file) => [file, merged[file]!]),
  );
}

/** The duration vitest recorded for a module, or null when it has none. */
function durationOf(module: TestModule): number | null {
  const ms = module.diagnostic()?.duration;
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : null;
}

export default class DurationManifestReporter implements Reporter {
  private readonly manifestPath: string;
  private readonly root: string;
  private readonly measured: DurationManifest = {};

  constructor(options: DurationManifestReporterOptions = {}) {
    // `process.cwd()` is the app root: every script that runs vitest here does
    // so with platform/app as the working directory, and the sequencer resolves
    // the manifest from its own __dirname, which is the same place.
    this.manifestPath = options.manifestPath ?? path.join(process.cwd(), DEFAULT_DELTA);
    this.root = options.root ?? path.dirname(this.manifestPath);
  }

  onTestModuleEnd(module: TestModule): void {
    const ms = durationOf(module);
    if (ms === null) return;
    this.measured[path.relative(this.root, module.moduleId)] = Math.round(ms);
  }

  onTestRunEnd(): void {
    // ONLY what this run measured. Emphatically not merged over the committed
    // manifest — see the note at the top of this file.
    const delta = mergeDurations({ existing: {}, measured: this.measured });
    writeFileSync(this.manifestPath, `${JSON.stringify(delta, null, 2)}\n`);
  }
}
