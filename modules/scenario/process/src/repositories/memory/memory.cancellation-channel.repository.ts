import type {
  CancellationMessage,
  CancellationPublisher,
  CancellationSubscriber,
} from "../../app/scenario.app.ts";

/** Cancellations published in one process, kept in order and handed to its subscribers. */
export class MemoryCancellationChannelRepository
  implements CancellationPublisher, CancellationSubscriber
{
  readonly published: CancellationMessage[] = [];
  readonly #listeners = new Set<(message: CancellationMessage) => void>();

  private constructor() {}

  static create(): MemoryCancellationChannelRepository {
    return new MemoryCancellationChannelRepository();
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
