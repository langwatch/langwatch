import {
  LangyWorkerMetricsPort,
  LangyWorkerPort,
  type LangyDispatchOutcome,
  type LangyWorkerCancelInput,
  type LangyWorkerDispatchInput,
  type LangyWorkerProbeInput,
  type LangyWorkerWarmInput,
} from "../ports/langy-turn-runtime.port";

export class UnavailableLangyWorkerAdapter extends LangyWorkerPort {
  private constructor(private readonly metrics: LangyWorkerMetricsPort) {
    super();
  }

  static create(metrics: LangyWorkerMetricsPort): UnavailableLangyWorkerAdapter {
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
