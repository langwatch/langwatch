import { LangyWorkerMetrics } from "../channels/langy-worker.channel.ts";

export class LangyWorkerMetricsNullService extends LangyWorkerMetrics {
  private constructor() {
    super();
  }

  static create(): LangyWorkerMetricsNullService {
    return new LangyWorkerMetricsNullService();
  }

  recordDispatch(): void {
    return;
  }
}
