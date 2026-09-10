import {
  LangyWorkerMetrics,
  LangyWorker,
  type LangyDispatchOutcome,
  type LangyWorkerCancelInput,
  type LangyWorkerDispatchInput,
  type LangyWorkerProbeInput,
  type LangyWorkerWarmInput,
} from "../app/langy.members.ts";

export class UnavailableLangyWorkerAdapter extends LangyWorker {
  private constructor(private readonly metrics: LangyWorkerMetrics) {
    super();
  }

  static create(metrics: LangyWorkerMetrics): UnavailableLangyWorkerAdapter {
    return new UnavailableLangyWorkerAdapter(metrics);
  }

  probe(_input: LangyWorkerProbeInput): Promise<boolean> {
    return Promise.resolve(false);
  }

  warm(_input: LangyWorkerWarmInput): Promise<void> {
    return Promise.resolve();
  }

  dispatch(_input: LangyWorkerDispatchInput): Promise<LangyDispatchOutcome> {
    this.metrics.recordDispatch({ outcome: "error" });
    return Promise.resolve("unavailable");
  }

  cancel(_input: LangyWorkerCancelInput): Promise<void> {
    return Promise.resolve();
  }
}
