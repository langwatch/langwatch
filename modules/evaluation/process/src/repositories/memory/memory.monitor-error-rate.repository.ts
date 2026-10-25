import {
  monitorErrorRateBuckets,
  type MonitorErrorRateCounts,
} from "../../rules/monitor-error-rate.rules.ts";
import type {
  MonitorErrorRateRepository,
  MonitorRevisionKey,
} from "../monitor-error-rate.repository.ts";

type RevisionState = {
  runs: Map<number, number>;
  errors: Map<number, number>;
  messages: Map<string, number>;
  reported: boolean;
};

function keyOf({ projectId, monitorId, monitorRevision }: MonitorRevisionKey): string {
  return `${projectId}:${monitorId}:${monitorRevision}`;
}

/** The Redis counts in one process; a refusing twin stands in for an unreachable store. */
export class MemoryMonitorErrorRateRepository implements MonitorErrorRateRepository {
  readonly #revisions = new Map<string, RevisionState>();

  private constructor(private readonly refuse: boolean) {}

  static create({ refuse = false }: { refuse?: boolean } = {}): MemoryMonitorErrorRateRepository {
    return new MemoryMonitorErrorRateRepository(refuse);
  }

  async record(
    input: MonitorRevisionKey & {
      outcome: "processed" | "error";
      errorMessage?: string;
      now: number;
    },
  ): Promise<MonitorErrorRateCounts> {
    const state = this.#state(input);
    const buckets = monitorErrorRateBuckets(input.now);
    const [newest] = buckets;
    if (newest === undefined) return { runs: 0, errors: 0 };
    state.runs.set(newest, (state.runs.get(newest) ?? 0) + 1);
    if (input.outcome === "error") {
      state.errors.set(newest, (state.errors.get(newest) ?? 0) + 1);
      if (input.errorMessage) {
        state.messages.set(input.errorMessage, (state.messages.get(input.errorMessage) ?? 0) + 1);
      }
    }
    const sum = (counts: Map<number, number>) =>
      buckets.reduce((total, bucket) => total + (counts.get(bucket) ?? 0), 0);
    return { runs: sum(state.runs), errors: sum(state.errors) };
  }

  async findTopErrors(input: MonitorRevisionKey): Promise<string[]> {
    return [...this.#state(input).messages]
      .toSorted(([, left], [, right]) => right - left)
      .map(([message]) => message);
  }

  async claimReport(input: MonitorRevisionKey): Promise<boolean> {
    const state = this.#state(input);
    if (state.reported) return false;
    state.reported = true;
    return true;
  }

  async releaseReport(input: MonitorRevisionKey): Promise<void> {
    this.#state(input).reported = false;
  }

  #state(input: MonitorRevisionKey): RevisionState {
    if (this.refuse) throw new Error("monitor error-rate store is unreachable");
    const key = keyOf(input);
    let state = this.#revisions.get(key);
    if (!state) {
      state = { runs: new Map(), errors: new Map(), messages: new Map(), reported: false };
      this.#revisions.set(key, state);
    }
    return state;
  }
}
