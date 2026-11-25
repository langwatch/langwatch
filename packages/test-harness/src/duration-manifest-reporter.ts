/**
 * Duration manifest for shard sequencer: each shard emits delta (not full),
 * overlaid onto committed baseline. Order-independent. See shardWeights.ts.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import type { Reporter, TestModule } from "vitest/node";

import type { DurationManifest } from "./shard-weights.ts";

export interface DurationManifestReporterOptions {
  /** Where the manifest lives. Paths inside it are relative to its directory. */
  manifestPath?: string;
  /** Paths in the manifest are relative to this. Defaults to the manifest's directory. */
  root?: string;
}

/**
 * Default delta path: must work with no CI args and resolve for sequencer
 * from app root.
 */
const DEFAULT_DELTA = "vitest.durations.delta.json";

/**
 * Fold this run's timings into whatever the manifest already holds.
 * Exported separately from the reporter so the merge — where the
 * interesting decisions are — is testable without driving a vitest run.
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
      .toSorted()
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
