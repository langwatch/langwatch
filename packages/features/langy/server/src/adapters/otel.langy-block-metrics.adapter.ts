import { counter } from "@langwatch/observability/metrics";
import type { LangyBlockCounter } from "../services/langy-final-parts.service.ts";
import { LangyBlockMetricsPort } from "../ports/langy-turn-runtime.port.ts";

export const LANGY_BLOCKS_METRIC_NAME = "langwatch_langy_blocks_total";

/**
 * The block-salvage series, pushed over OTLP. `LangyFinalPartsService.build` takes a `countBlock`
 * and defaults it to a no-op, so a caller that passes nothing publishes nothing.
 */
export class LangyBlockOtelMetricsAdapter extends LangyBlockMetricsPort {
  private constructor() {
    super();
  }

  static create(): LangyBlockOtelMetricsAdapter {
    return new LangyBlockOtelMetricsAdapter();
  }

  blockCounter(): LangyBlockCounter {
    const blocks = counter({
      name: LANGY_BLOCKS_METRIC_NAME,
      description: "Langy derived blocks by salvage outcome",
    });
    return (reason: string) => blocks.inc({ outcome: reason }, 1);
  }
}
