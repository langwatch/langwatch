import { LangyBlockMetricsPort } from "../ports/langy-turn-runtime.port.ts";
import type { LangyBlockCounter } from "../services/langy-final-parts.service.ts";

/** The default: a deployment composed no block-metrics collector publishes nothing. */
export class NullLangyBlockMetricsAdapter extends LangyBlockMetricsPort {
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
