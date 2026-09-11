/**
 * Ship captured Ollama spans to LangWatch. A local model answers fast and
 * often, so spans are buffered and flushed on a timer (and once more when the
 * session ends), which is also what lets a failed upload retry. Nothing here
 * may end a session: every failure is swallowed, reported once, and the
 * buffer is bounded so a control plane that is down cannot grow the process.
 */

import { buildOllamaExportRequest, type OtlpSpan } from "./ollama-trace";

/** Spans held for a retry. Past this, the oldest are dropped. */
const MAX_BUFFERED_SPANS = 500;

/** How long a flush may take before it is abandoned. */
const FLUSH_TIMEOUT_MS = 5_000;

export interface OllamaSpanEmitter {
  add(span: OtlpSpan): void;
  /** Send whatever is buffered. Never rejects. */
  flush(): Promise<void>;
  /** Stop the timer and send the remainder. Never rejects. */
  close(): Promise<void>;
  /** How many spans this emitter has handed to a successful flush. */
  sent(): number;
}

export interface OllamaSpanEmitterOptions {
  /** Full OTLP traces URL, e.g. `https://app.langwatch.ai/api/otel/v1/traces`. */
  tracesEndpoint: string;
  token: string;
  flushIntervalMs?: number;
  fetchImpl?: typeof fetch;
  /** Where the one-time failure note goes. Defaults to stderr. */
  warn?: (message: string) => void;
}

/**
 * An emitter that accepts spans and does nothing with them, for a session
 * with no LangWatch scope. The proxy still runs, so the wrapped command
 * behaves identically whether or not anything is being captured.
 */
export function createDiscardingSpanEmitter(): OllamaSpanEmitter {
  return {
    add: () => undefined,
    flush: async () => undefined,
    close: async () => undefined,
    sent: () => 0,
  };
}

export function createOllamaSpanEmitter(options: OllamaSpanEmitterOptions): OllamaSpanEmitter {
  const {
    tracesEndpoint,
    token,
    flushIntervalMs = 2_000,
    fetchImpl,
    warn = (message: string) => process.stderr.write(`${message}\n`),
  } = options;

  let buffered: OtlpSpan[] = [];
  let sentCount = 0;
  let warnedOnce = false;

  const post = async (spans: OtlpSpan[]): Promise<boolean> => {
    const doFetch = fetchImpl ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);
    try {
      const response = await doFetch(tracesEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(buildOllamaExportRequest(spans)),
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };

  const sendBuffered = async (): Promise<void> => {
    if (buffered.length === 0) return;
    const batch = buffered;
    buffered = [];
    const landed = await post(batch);
    if (landed) {
      sentCount += batch.length;
      return;
    }
    // Put the batch back in front of anything captured while it was in
    // flight, so the retry keeps the calls in the order they happened.
    buffered = [...batch, ...buffered].slice(-MAX_BUFFERED_SPANS);
    if (!warnedOnce) {
      warnedOnce = true;
      warn(
        "[langwatch] could not reach LangWatch; ollama calls will be retried in the background.",
      );
    }
  };

  /**
   * Flushes run one at a time, in order. Two overlapping ones would each take
   * a copy of the buffer and send the same calls twice under different span
   * ids — a duplicate in the UI rather than a retry — and a `close` racing a
   * timer tick would return before the tick it is waiting on had finished.
   */
  let pending: Promise<void> = Promise.resolve();
  const flush = (): Promise<void> => {
    pending = pending.then(sendBuffered);
    return pending;
  };

  const timer = setInterval(() => {
    void flush();
  }, flushIntervalMs);
  // The wrapped command owns the process lifetime; the flush timer must never
  // be the thing keeping it alive.
  timer.unref?.();

  return {
    add(span: OtlpSpan): void {
      buffered.push(span);
      if (buffered.length > MAX_BUFFERED_SPANS) {
        buffered = buffered.slice(-MAX_BUFFERED_SPANS);
      }
    },
    flush,
    async close(): Promise<void> {
      clearInterval(timer);
      // One retry: the common failure at this point is a flush that raced the
      // command's own exit, and the spans are back on the buffer.
      await flush();
      await flush();
    },
    sent: () => sentCount,
  };
}
