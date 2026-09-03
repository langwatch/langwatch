import { LangyWorkerMetricsPort } from "../ports/langy-turn-runtime.port";

export class NullLangyWorkerMetricsAdapter extends LangyWorkerMetricsPort {
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
