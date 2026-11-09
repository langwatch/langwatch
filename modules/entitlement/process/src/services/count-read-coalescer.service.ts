import { HandledError, isHandledTransientRefusal } from "@langwatch/handled-error";

/**
 * How long a count that failed is answered with its failure instead of being read again. The
 * ingest doors ask on every batch and admit on a failure, so re-reading a count that just ran out
 * of memory only repeats the same expensive failure on the cluster the batch is written to.
 */
const FAILED_COUNT_RETRY_AFTER_MS = 30_000;

/**
 * A count answered from a recent failure: a transient 503, so callers warn and retry. Fresh per
 * call, so its log line keeps its own trace. The store's error is a logged reason, never the body.
 */
export class RecentCountFailureError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor({ failure }: { failure: Error }) {
    super("service_unavailable", "The usage count failed moments ago; it is read again shortly.", {
      httpStatus: 503,
      fault: "platform",
      retryable: true,
      reasons: [failure],
    });
    this.name = "RecentCountFailureError";
  }
}

/** Shares one read per key between concurrent callers and remembers the last failure per key. */
export class CountReadCoalescerService<T> {
  readonly #inFlight = new Map<string, Promise<T>>();
  readonly #failed = new Map<string, { failure: Error; retryAt: number }>();

  private constructor(private readonly now: () => number) {}

  static create<T>({ now }: { now: () => number }): CountReadCoalescerService<T> {
    return new CountReadCoalescerService<T>(now);
  }

  /** `reuseFailure` callers get a recent failure back; others read, and still record theirs. */
  async run({
    key,
    reuseFailure,
    read,
  }: {
    key: string;
    reuseFailure: boolean;
    read: () => Promise<T>;
  }): Promise<T> {
    const failed = this.#failed.get(key);
    if (failed && failed.retryAt <= this.now()) {
      this.#failed.delete(key);
    } else if (failed && reuseFailure) {
      throw new RecentCountFailureError({ failure: failed.failure });
    }

    const inFlight = this.#inFlight.get(key);
    if (inFlight) return inFlight;

    const pending = read();
    this.#inFlight.set(key, pending);
    try {
      const value = await pending;
      this.#failed.delete(key);
      return value;
    } catch (error) {
      // A busy or unreachable store answers a retry cheaply; only a failed read is held back.
      if (!isHandledTransientRefusal(error)) {
        const failure = error instanceof Error ? error : new Error(String(error));
        this.#failed.set(key, { failure, retryAt: this.now() + FAILED_COUNT_RETRY_AFTER_MS });
      }
      throw error;
    } finally {
      this.#inFlight.delete(key);
    }
  }
}
