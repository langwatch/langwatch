import { statSync } from "node:fs";

import { BaseSequencer, type TestSpecification } from "vitest/node";

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
 * WEIGHT IS FILE SIZE, WHICH IS A PROXY. Runtime would be the honest weight,
 * and vitest does cache per-file durations — but only from a previous run on
 * the same machine, and a CI runner is always cold, so on the one machine that
 * matters the cache is empty. Bytes are available before anything executes and
 * correlate well enough in practice: a 900-line suite with thirty cases really
 * does tend to cost more than a 40-line one. It cannot beat real timings on a
 * file that is short but slow (a long `waitFor`, a container boot), so this
 * narrows the spread rather than eliminating it.
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
 * A file that cannot be stat'd still has to land in exactly one shard, and
 * every shard has to agree on which. Returning a constant keeps it in the
 * ordering rather than dropping it from the run.
 */
function weigh(moduleId: string): number {
  try {
    return statSync(moduleId).size;
  } catch {
    return 1;
  }
}
