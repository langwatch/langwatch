import { LangyBlockMetrics } from "../app/langy.infrastructure.ts";
import type { LangyBlockCounter } from "./langy-final-parts.service.ts";

/** The default: a deployment composed no block-metrics collector publishes nothing. */
export class NullLangyBlockMetricsAdapter extends LangyBlockMetrics {
  private constructor() {
    super();
  }

  static create(): NullLangyBlockMetricsAdapter {
    return new NullLangyBlockMetricsAdapter();
  }

  blockCounter(): LangyBlockCounter {
    return () => undefined;
  }
}
