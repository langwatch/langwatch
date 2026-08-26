import {
  LangyWorkerMetricsPort,
  type LangyDispatchOutcome,
} from "@langwatch/langy-server";
import { getLangyDispatchCounter } from "~/server/metrics";

export class AppLangyWorkerMetricsPort extends LangyWorkerMetricsPort {
  static create(): AppLangyWorkerMetricsPort {
    return new AppLangyWorkerMetricsPort();
  }

  private constructor() {
    super();
  }

  recordDispatch(input: { outcome: LangyDispatchOutcome | "error" }): void {
    const metricOutcome =
      input.outcome === "credentialsRequired" ? "credentials_required" : input.outcome;

    getLangyDispatchCounter(metricOutcome).inc();
  }
}
