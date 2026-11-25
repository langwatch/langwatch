import type { RuntimeEvent } from "../shared/runtime-contract.ts";

// Single-consumer event bus. Producers call bus.emit(), consumer calls
// runtime.events() once.
export class EventBus implements AsyncIterable<RuntimeEvent> {
  private readonly buffer: RuntimeEvent[] = [];
  private readonly waiters: ((result: IteratorResult<RuntimeEvent>) => void)[] = [];
  private readonly taps = new Set<(event: RuntimeEvent) => void>();
  private done = false;

  /**
   * Observes every event synchronously without consuming the
   * single-consumer iterator, so supervision can notice its own
   * "healthy" event and tell a later crash from a boot failure.
   */
  tap(listener: (event: RuntimeEvent) => void): () => void {
    this.taps.add(listener);
    return () => {
      this.taps.delete(listener);
    };
  }

  emit(event: RuntimeEvent): void {
    if (this.done) return;
    for (const tap of this.taps) {
      try {
        tap(event);
      } catch {
        // A misbehaving tap must not break delivery to other taps or the iterator.
      }
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: event, done: false });
      return;
    }
    this.buffer.push(event);
  }

  end(): void {
    if (this.done) return;
    this.done = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
    return {
      next: () => this.nextValue(),
      return: async () => {
        this.end();
        return { value: undefined as never, done: true };
      },
    };
  }

  private nextValue(): Promise<IteratorResult<RuntimeEvent>> {
    const buffered = this.buffer.shift();
    if (buffered) return Promise.resolve({ value: buffered, done: false });
    if (this.done) return Promise.resolve({ value: undefined as never, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}
