import {
  LangyWorker,
  type LangyDispatchOutcome,
  type LangyWorkerCancelInput,
  type LangyWorkerDispatchInput,
  type LangyWorkerProbeInput,
  type LangyWorkerWarmInput,
} from "../langy-worker.channel.ts";

/** The memory twin: records every call and answers with the outcome it was told to. */
export class MemoryLangyWorkerChannel extends LangyWorker {
  readonly probed: LangyWorkerProbeInput[] = [];
  readonly warmed: LangyWorkerWarmInput[] = [];
  readonly dispatched: LangyWorkerDispatchInput[] = [];
  readonly cancelled: LangyWorkerCancelInput[] = [];
  #alive = true;
  #outcome: LangyDispatchOutcome = "accepted";

  static create(): MemoryLangyWorkerChannel {
    return new MemoryLangyWorkerChannel();
  }

  setAlive({ alive }: { alive: boolean }): void {
    this.#alive = alive;
  }

  setOutcome({ outcome }: { outcome: LangyDispatchOutcome }): void {
    this.#outcome = outcome;
  }

  probe(input: LangyWorkerProbeInput): Promise<boolean> {
    this.probed.push(input);
    return Promise.resolve(this.#alive);
  }

  warm(input: LangyWorkerWarmInput): Promise<void> {
    this.warmed.push(input);
    return Promise.resolve();
  }

  dispatch(input: LangyWorkerDispatchInput): Promise<LangyDispatchOutcome> {
    this.dispatched.push(input);
    return Promise.resolve(this.#outcome);
  }

  cancel(input: LangyWorkerCancelInput): Promise<void> {
    this.cancelled.push(input);
    return Promise.resolve();
  }
}
