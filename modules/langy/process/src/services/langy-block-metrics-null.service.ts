import { LangyBlockMetrics } from "../app/langy.members.ts";
import type { LangyBlockCounter } from "./langy-final-parts.service.ts";

/** The default: a deployment composed no block-metrics collector publishes nothing. */
export class LangyBlockMetricsNullService extends LangyBlockMetrics {
  private constructor() {
    super();
  }

  static create(): LangyBlockMetricsNullService {
    return new LangyBlockMetricsNullService();
  }

  blockCounter(): LangyBlockCounter {
    return () => undefined;
  }
}
