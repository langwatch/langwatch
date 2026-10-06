import { counter } from "@langwatch/observability/metrics";

import type { LangyBlockCounter } from "./langy-final-parts.service.ts";

/**
 * Preserves the block-salvage series `LangyFinalPartsService.build` counts, without coupling the
 * feature to app metrics. `blockCounter()` returns the per-reason counter callback.
 */
export abstract class LangyBlockMetrics {
  abstract blockCounter(): (reason: string) => void;
}

const LANGY_BLOCKS_METRIC_NAME = "langwatch_langy_blocks_total";

/**
 * The block-salvage series, pushed over OTLP. `LangyFinalPartsService.build` takes a `countBlock`
 * and defaults it to a no-op, so a caller that passes nothing publishes nothing.
 */
export class LangyBlockMetricsOtelService extends LangyBlockMetrics {
  private constructor() {
    super();
  }

  static create(): LangyBlockMetricsOtelService {
    return new LangyBlockMetricsOtelService();
  }

  blockCounter(): LangyBlockCounter {
    const blocks = counter({
      name: LANGY_BLOCKS_METRIC_NAME,
      description: "Langy derived blocks by salvage outcome",
    });
    return (reason: string) => blocks.inc({ outcome: reason }, 1);
  }
}
