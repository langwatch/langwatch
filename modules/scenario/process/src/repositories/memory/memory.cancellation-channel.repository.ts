import type { CancellationMessage, CancellationPublisher } from "../../app/scenario.app.ts";

/** Cancellations published in one process, kept in order for whoever reads them back. */
export class MemoryCancellationChannelRepository implements CancellationPublisher {
  readonly published: CancellationMessage[] = [];

  private constructor() {}

  static create(): MemoryCancellationChannelRepository {
    return new MemoryCancellationChannelRepository();
  }

  async publish(message: CancellationMessage): Promise<void> {
    this.published.push(message);
  }
}
