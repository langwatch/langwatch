/**
 * The weights the shard sequencer partitions by.
 *
 * The sequencer splits a run by longest-processing-time-first, which is only as
 * good as the number it is given for "processing time". It weighed FILE SIZE,
 * and said so: bytes are available before anything executes and correlate
 * roughly with cost. The measured spread shows how roughly — six integration
 * shards of near-identical file counts ran 547, 573, 595, 649, 726 and 766
 * seconds. A matrix is paced by its slowest leg, so the run paid 766 while a
 * runner sat idle for three and a half minutes.
 *
 * Real durations are the honest weight. Vitest caches per-file timings, but only
 * from a previous run on the same machine, and a CI runner is always cold — so
 * on the one machine that matters the cache is empty. This reads them instead
 * from a manifest committed to the repo and refreshed by a scheduled run.
 *
 * DETERMINISM IS THE CONSTRAINT, not accuracy. Every shard computes the split
 * independently in its own process, and they must reach the identical answer or
 * a file is dropped from the run or executed twice — silently, and green. That
 * rules out anything a shard might or might not have: a restored cache, a
 * previous run's state, a network fetch. A file checked out with the source is
 * the same for all of them, and when it is missing entirely every shard falls
 * back to bytes together.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Milliseconds, keyed by path relative to the manifest's root. */
export type DurationManifest = Record<string, number>;

/**
 * Read a duration manifest, or return an empty one.
 *
 * A missing, unparseable or malformed manifest is not an error: it means every
 * shard weighs by bytes, which is exactly the behaviour that predates this and
 * is still correct, just less even. Failing the run instead would let a bad
 * merge of a generated file take CI down.
 */
export function loadDurationManifest(manifestPath: string): DurationManifest {
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }

  const manifest: DurationManifest = {};
  for (const [file, duration] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    // Only finite positive numbers are usable as weights. A zero or a negative
    // would let a file sink to the front of every bin and unbalance the split
    // in the direction this exists to fix.
    if (
      typeof duration === "number" &&
      Number.isFinite(duration) &&
      duration > 0
    ) {
      manifest[file] = duration;
    }
  }
  return manifest;
}

/**
 * Weigh one file, in arbitrary units that are only ever compared to each other.
 *
 * A file the manifest knows is weighed by the milliseconds it took. A file it
 * does not — a test added since the manifest was refreshed — falls back to its
 * size, scaled so the two are on a comparable footing rather than one class of
 * file always sorting above the other. The scale comes from the manifest
 * itself: the average measured cost per byte of the files it does know.
 */
export function createWeigher({
  manifest,
  root,
}: {
  manifest: DurationManifest;
  root: string;
}): (moduleId: string) => number {
  let knownDurationTotal = 0;
  let knownByteTotal = 0;

  for (const [file, duration] of Object.entries(manifest)) {
    let size: number;
    try {
      size = statSync(path.join(root, file)).size;
    } catch {
      continue;
    }
    if (size <= 0) continue;
    knownDurationTotal += duration;
    knownByteTotal += size;
  }

  // With nothing measured, bytes are the weight and the scale is irrelevant —
  // every file goes through the same multiplication.
  const msPerByte =
    knownByteTotal > 0 ? knownDurationTotal / knownByteTotal : 1;

  return (moduleId: string): number => {
    const relative = path.relative(root, moduleId);
    const measured = manifest[relative];
    if (measured !== undefined) return measured;

    try {
      return statSync(moduleId).size * msPerByte;
    } catch {
      // A file that cannot be stat'd still has to land in exactly one shard,
      // and every shard has to agree on which. A constant keeps it in the
      // ordering rather than dropping it from the run.
      return 1;
    }
  };
}
