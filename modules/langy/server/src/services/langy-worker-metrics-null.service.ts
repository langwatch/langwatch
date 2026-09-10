import { LangyWorkerMetrics } from "../app/langy.infrastructure.ts";

export class NullLangyWorkerMetricsAdapter extends LangyWorkerMetrics {
  private constructor() {
    super();
  }

  static create(): NullLangyWorkerMetricsAdapter {
    return new NullLangyWorkerMetricsAdapter();
  }

  recordDispatch(): void {
    return;
  }
}
