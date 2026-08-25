import type { RuntimeEvent } from "../shared/runtime-contract.ts";

/**
 * Single-consumer event bus. The CLI calls `runtime.events(ctx)` exactly
 * once and gets back this AsyncIterable. Producers call `bus.emit(event)`
 * which buffers if no consumer is currently awaiting `next()`. Once `bus.end()`
 * is called every pending consumer wakes up with `{ done: true }`.
 *
 * Multi-consumer is intentionally not supported: the CLI animates and tees
 * logs from a single iterator. If we ever need fan-out we tee at the consumer.
 */
export class EventBus implements AsyncIterable<RuntimeEvent> {
  private readonly buffer: RuntimeEvent[] = [];
  private readonly waiters: Array<(result: IteratorResult<RuntimeEvent>) => void> = [];
  private readonly taps = new Set<(event: RuntimeEvent) => void>();
  private done = false;

  /**
   * Observe every event synchronously at emit time without consuming the
   * single-consumer iterator. Supervision uses this to notice its own
   * service's "healthy" event (emitted by the start helpers) so it knows a
   * later crash happened in steady state, not during boot. Returns an
   * unsubscribe function. Events emitted after end() are not observed.
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
