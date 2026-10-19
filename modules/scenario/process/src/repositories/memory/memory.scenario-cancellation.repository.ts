import type { CancellationMessage } from "../../app/scenario.app.ts";
import { ScenarioCancellationRepository } from "../scenario-cancellation.repository.ts";

/** Cancellations published in one process, kept in order and handed to its subscribers. */
export class MemoryScenarioCancellationRepository extends ScenarioCancellationRepository {
  readonly published: CancellationMessage[] = [];
  readonly #listeners = new Set<(message: CancellationMessage) => void>();

  private constructor() {
    super();
  }

  static create(): MemoryScenarioCancellationRepository {
    return new MemoryScenarioCancellationRepository();
  }

  async publish(message: CancellationMessage): Promise<void> {
    this.published.push(message);
    for (const listener of this.#listeners) listener(message);
  }

  async subscribe(
    onCancellation: (message: CancellationMessage) => void,
  ): Promise<() => Promise<void>> {
    this.#listeners.add(onCancellation);
    return async () => {
      this.#listeners.delete(onCancellation);
    };
  }
}
