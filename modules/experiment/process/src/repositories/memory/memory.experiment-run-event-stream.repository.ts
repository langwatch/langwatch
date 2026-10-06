import {
  ExperimentRunEventStreamRepository,
  type ExperimentRunStreamMessage,
  type ExperimentRunStreamUnsubscribe,
} from "../experiment-run-event-stream.repository.ts";

type Listener = (message: ExperimentRunStreamMessage) => void;

/** One process is the whole deployment: a frame reaches this process's subscribers or nobody. */
export class MemoryExperimentRunEventStreamRepository extends ExperimentRunEventStreamRepository {
  /** Every frame published, per run, in order; what a test reads back. */
  readonly published = new Map<string, ExperimentRunStreamMessage[]>();
  readonly #listeners = new Map<string, Set<Listener>>();

  private constructor() {
    super();
  }

  static create(): MemoryExperimentRunEventStreamRepository {
    return new MemoryExperimentRunEventStreamRepository();
  }

  async publish({
    runId,
    seq,
    frame,
  }: { runId: string } & ExperimentRunStreamMessage): Promise<void> {
    const message = { seq, frame };
    this.published.set(runId, [...(this.published.get(runId) ?? []), message]);
    for (const listener of this.#listeners.get(runId) ?? []) listener(message);
  }

  async subscribe({
    runId,
    onMessage,
  }: {
    runId: string;
    onMessage: Listener;
  }): Promise<ExperimentRunStreamUnsubscribe> {
    const listeners = this.#listeners.get(runId) ?? new Set<Listener>();
    listeners.add(onMessage);
    this.#listeners.set(runId, listeners);
    return async () => {
      listeners.delete(onMessage);
      if (listeners.size === 0 && this.#listeners.get(runId) === listeners) {
        this.#listeners.delete(runId);
      }
    };
  }

  close(): void {
    this.#listeners.clear();
  }
}
