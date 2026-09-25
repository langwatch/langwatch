import { LangyWorkerMetrics } from "../app/langy.members.ts";

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
