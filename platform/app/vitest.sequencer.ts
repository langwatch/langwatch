import { join } from "node:path";

import { BaseSequencer, type TestSpecification } from "vitest/node";

import {
  createWeigher,
  loadDurationManifest,
} from "./src/test-utils/shardWeights";

/** This file sits at the app root, which is what manifest paths are relative to. */
const APP_ROOT = __dirname;

/** Refreshed by the scheduled `shard-durations` job; absent is fine. */
const DURATION_MANIFEST_FILE = "vitest.durations.json";

/**
 * Splits a sharded run by weight instead of by file count.
 *
 * Vitest's `BaseSequencer.shard()` hashes each file's path, sorts by the hash
 * and slices that list into equal-sized pieces. Every shard therefore gets the
 * same NUMBER of files, which is only the same amount of WORK if the files all
 * cost the same. They do not: with four unit shards of 402/402/402/401 files,
 * the measured jobs ran 2.7, 4.8, 3.3 and 2.9 minutes. A matrix finishes when
 * its slowest leg does, so the run was paced by 4.8 while another runner sat
 * idle for two minutes.
 *
 * This assigns files to shards by longest-processing-time first: sort heaviest
 * to lightest, and put each file in whichever shard is currently lightest. It
 * is the standard greedy approximation for multiway partitioning and gets the
 * legs close to even in one pass.
 *
 * WEIGHT IS MEASURED DURATION, FALLING BACK TO FILE SIZE. It was bytes alone,
 * which is a proxy, and the spread showed how loose a one: six integration
 * shards of near-identical file counts ran 547, 573, 595, 649, 726 and 766
 * seconds, so the matrix paid 766 while a runner sat idle for three and a half
 * minutes. Bytes cannot see a file that is short but slow — a long `waitFor`, a
 * service boot, a Go compile.
 *
 * Real timings come from a manifest committed to the repo (vitest.durations.json)
 * and refreshed by a scheduled run; vitest's own duration cache is no use here
 * because it only holds a previous run from the same machine, and a CI runner is
 * always cold. Files the manifest does not know are still weighed by size,
 * scaled onto the same footing. See src/test-utils/shardWeights.ts.
 *
 * Determinism matters more than the weighting here. Each shard runs in its own
 * process and computes this assignment independently, so all of them must
 * agree on the split or files would be dropped or run twice. Sorting is total
 * (size descending, then path) and the bin choice breaks ties toward the lowest
 * index, so every process walks the identical sequence.
 */
export default class WeightBalancedSequencer extends BaseSequencer {
  async shard(specs: TestSpecification[]): Promise<TestSpecification[]> {
    const shard = this.ctx.config.shard;
    if (!shard) return specs;

    const { index, count } = shard;
    if (count <= 1) return specs;

    const weighted = specs
      .map((spec) => ({ spec, weight: weigh(spec.moduleId) }))
      .sort(
        (a, b) =>
          b.weight - a.weight || (a.spec.moduleId < b.spec.moduleId ? -1 : 1),
      );

    const buckets: TestSpecification[][] = Array.from(
      { length: count },
      () => [],
    );
    const totals = new Array<number>(count).fill(0);

    for (const { spec, weight } of weighted) {
      let lightest = 0;
      for (let i = 1; i < count; i++) {
        if (totals[i]! < totals[lightest]!) lightest = i;
      }
      buckets[lightest]!.push(spec);
      totals[lightest]! += weight;
    }

    // `--shard=N/M` counts from one.
    return buckets[index - 1] ?? [];
  }
}

/**
 * Weights come from measured durations where they exist, and from file size
 * where they do not. See src/test-utils/shardWeights.ts for why the manifest is
 * a committed file rather than a cache, and what happens when it is absent.
 *
 * Built once at module load: every spec in a run is weighed against the same
 * manifest and the same byte-to-millisecond scale, and the scale is derived by
 * reading the manifest's own files, which is not work to repeat per file.
 */
const weigh = createWeigher({
  manifest: loadDurationManifest(join(APP_ROOT, DURATION_MANIFEST_FILE)),
  root: APP_ROOT,
});
