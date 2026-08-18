/**
 * Unit coverage for the shared fetch-with-retry helper.
 *
 * The interesting behaviour is 429: it was previously swept into the
 * fail-fast 4xx branch, so `http_custom` and `claude_compliance` gave up on a
 * rate limit instead of waiting. It is now retried, and the deadline guard is
 * what stops that change turning a visible error into a silent timeout.
 *
 * Sleeps are injected so retry timing is asserted rather than waited out.
 *
 * Spec: specs/ai-governance/puller-framework/microsoft-365-audit.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface QueuedResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  /** Supplied instead of `body` when a test needs to watch the read itself. */
  stream?: ReadableStream<Uint8Array>;
}

let capturedUrls: string[] = [];
let responseQueue: QueuedResponse[] = [];
let transportErrors: Array<Error | null> = [];

beforeEach(() => {
  capturedUrls = [];
  responseQueue = [];
  transportErrors = [];
  vi.doMock("~/utils/ssrfProtection", () => ({
    ssrfSafeFetch: async (url: string) => {
      capturedUrls.push(url);
      const transportError = transportErrors.shift();
      if (transportError) throw transportError;
      const next = responseQueue.shift();
      if (!next) throw new Error("test bug: no queued response");
      if (next.stream) {
        return new Response(next.stream, {
          status: next.status,
          headers: { "content-type": "text/plain", ...(next.headers ?? {}) },
        });
      }
      return new Response(JSON.stringify(next.body ?? {}), {
        status: next.status,
        headers: {
          "content-type": "application/json",
          ...(next.headers ?? {}),
        },
      });
    },
  }));
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

const URL_UNDER_TEST = "https://manage.office.test/api/v1.0/t/activity/feed";

async function loadHelper() {
  return await import("../shared/httpRetry");
}

describe("fetchWithRetry", () => {
  /** @scenario Retry behaviour per response status */
  it("returns 2xx, retries 429 and 5xx, and fails fast on other 4xx", async () => {
    const { fetchWithRetry } = await loadHelper();
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);

    // 200 — returned, no retry.
    responseQueue = [{ status: 200, body: { ok: true } }];
    const ok = await fetchWithRetry({ url: URL_UNDER_TEST, sleep });
    expect(ok.status).toBe(200);
    expect(capturedUrls).toHaveLength(1);
    expect(sleeps).toEqual([]);

    // 429 with Retry-After: 2 — waits the stated two seconds, then succeeds.
    capturedUrls = [];
    sleeps.length = 0;
    responseQueue = [
      { status: 429, headers: { "retry-after": "2" } },
      { status: 200, body: { ok: true } },
    ];
    const afterRateLimit = await fetchWithRetry({ url: URL_UNDER_TEST, sleep });
    expect(afterRateLimit.status).toBe(200);
    expect(sleeps).toEqual([2000]);

    // 429 without Retry-After — falls back to the backoff schedule.
    capturedUrls = [];
    sleeps.length = 0;
    responseQueue = [{ status: 429 }, { status: 200, body: { ok: true } }];
    const afterBackoff = await fetchWithRetry({ url: URL_UNDER_TEST, sleep });
    expect(afterBackoff.status).toBe(200);
    expect(sleeps).toEqual([250]);

    // 503 — retried on the same schedule the 5xx path always used.
    capturedUrls = [];
    sleeps.length = 0;
    responseQueue = [{ status: 503 }, { status: 200, body: { ok: true } }];
    const afterServerError = await fetchWithRetry({
      url: URL_UNDER_TEST,
      sleep,
    });
    expect(afterServerError.status).toBe(200);
    expect(sleeps).toEqual([250]);

    // 400 and 401 — thrown immediately, never retried.
    for (const status of [400, 401]) {
      capturedUrls = [];
      sleeps.length = 0;
      responseQueue = [{ status }, { status: 200, body: { ok: true } }];
      await expect(
        fetchWithRetry({ url: URL_UNDER_TEST, sleep }),
      ).rejects.toThrow(new RegExp(`HTTP ${status}`));
      expect(capturedUrls).toHaveLength(1);
      expect(sleeps).toEqual([]);
    }
  });

  /** @scenario Retry budget exhausted surfaces the failure rather than returning empty */
  it("throws once the retry budget is spent instead of reporting an empty success", async () => {
    const { fetchWithRetry } = await loadHelper();
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);

    responseQueue = [{ status: 429 }, { status: 429 }, { status: 429 }];

    await expect(
      fetchWithRetry({ url: URL_UNDER_TEST, sleep }),
    ).rejects.toThrow(/HTTP 429/);

    // Three attempts, two waits between them — then it gives up loudly.
    expect(capturedUrls).toHaveLength(3);
    expect(sleeps).toEqual([250, 500]);
  });

  /** @scenario Retry wait that would overrun the job deadline is not attempted */
  it("refuses to sleep past the deadline and hands control back instead", async () => {
    const { fetchWithRetry, RetryDeadlineExceededError } = await loadHelper();
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);

    const nowMs = 1_000_000;
    // Server asks for 30s; only 5s of the run remain.
    responseQueue = [{ status: 429, headers: { "retry-after": "30" } }];

    await expect(
      fetchWithRetry({
        url: URL_UNDER_TEST,
        sleep,
        now: () => nowMs,
        deadlineAtMs: nowMs + 5_000,
      }),
    ).rejects.toBeInstanceOf(RetryDeadlineExceededError);

    // The point of the guard: it never slept, so the run can persist its
    // cursor and the next one resumes.
    expect(sleeps).toEqual([]);
    expect(capturedUrls).toHaveLength(1);
  });

  it("treats an absent or unparseable Retry-After as no instruction", async () => {
    const { parseRetryAfterMs } = await loadHelper();
    const now = Date.parse("2026-01-01T00:00:00Z");

    expect(parseRetryAfterMs(null, now)).toBeNull();
    expect(parseRetryAfterMs("", now)).toBeNull();
    expect(parseRetryAfterMs("soon", now)).toBeNull();
    expect(parseRetryAfterMs("7", now)).toBe(7000);
    expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:10 GMT", now)).toBe(
      10_000,
    );
    // A date already past means retry now, not travel backwards.
    expect(parseRetryAfterMs("Thu, 01 Jan 2025 00:00:00 GMT", now)).toBe(0);
  });

  it("caps a server-supplied Retry-After rather than sleeping arbitrarily long", async () => {
    const { fetchWithRetry, MAX_RETRY_AFTER_MS } = await loadHelper();
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);

    responseQueue = [
      { status: 429, headers: { "retry-after": "86400" } },
      { status: 200, body: { ok: true } },
    ];

    await fetchWithRetry({ url: URL_UNDER_TEST, sleep });
    expect(sleeps).toEqual([MAX_RETRY_AFTER_MS]);
  });

  it("retries transport failures but not client errors", async () => {
    const { fetchWithRetry } = await loadHelper();
    const sleep = async () => void 0;

    transportErrors = [new Error("ECONNRESET"), null];
    responseQueue = [{ status: 200, body: { ok: true } }];

    const response = await fetchWithRetry({ url: URL_UNDER_TEST, sleep });
    expect(response.status).toBe(200);
    expect(capturedUrls).toHaveLength(2);
  });
});

describe("existing adapters after the 429 change", () => {
  /** @scenario Existing adapters gain 429 handling without losing their failure signal */
  it("retries a resolvable 429 but still ends the run visibly when it does not resolve", async () => {
    // `http_custom` (http_polling) and `claude_compliance` both route their
    // fetches through this helper now. Before the extraction a 429 fell into
    // the fail-fast 4xx branch and ended the run immediately.
    const { HttpPollingPullerAdapter } = await import(
      "../httpPollingPullerAdapter"
    );
    const adapter = new HttpPollingPullerAdapter();

    const config = {
      adapter: "http_polling" as const,
      url: "https://api.example.test/v1/audit-log",
      method: "GET" as const,
      headers: {},
      authMode: "header_template" as const,
      cursorJsonPath: "$.next_cursor",
      cursorQueryParam: "cursor",
      eventsJsonPath: "$.events",
      schedule: "*/5 * * * *",
      eventMapping: {
        source_event_id: "$.id",
        event_timestamp: "$.created_at",
        actor: "$.user.email",
        action: "$.event_type",
        target: "$.model",
      },
    };

    // A 429 that resolves inside the budget now succeeds rather than failing.
    responseQueue = [
      { status: 429, headers: { "retry-after": "0" } },
      { status: 200, body: { events: [], next_cursor: null } },
    ];
    const recovered = await adapter.runOnce({ cursor: null }, config);
    expect(recovered.errorCount).toBe(0);

    // A 429 that never resolves still ends the run with a visible error —
    // the change must not trade a loud failure for a silent one.
    capturedUrls = [];
    responseQueue = [
      { status: 429, headers: { "retry-after": "0" } },
      { status: 429, headers: { "retry-after": "0" } },
      { status: 429, headers: { "retry-after": "0" } },
    ];
    const exhausted = await adapter.runOnce({ cursor: null }, config);
    expect(exhausted.errorCount).toBe(1);
    expect(exhausted.events).toEqual([]);
    // Cursor is left untouched so the next run retries the same page.
    expect(exhausted.cursor).toBeNull();
  });
});

describe("given an error response with an oversized body", () => {
  describe("when the failure is read for diagnosis", () => {
    /** @scenario "An oversized error body is bounded before it is allocated" */
    it("stops pulling at the ceiling instead of buffering the whole body", async () => {
      const CHUNK = "x".repeat(1_000);
      const TOTAL_CHUNKS = 5_000; // 5 MB if anything reads it all
      let chunksPulled = 0;

      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunksPulled >= TOTAL_CHUNKS) {
            controller.close();
            return;
          }
          chunksPulled += 1;
          controller.enqueue(new TextEncoder().encode(CHUNK));
        },
      });

      responseQueue = [{ status: 400, stream }];
      const { fetchWithRetry, HttpResponseError } = await loadHelper();

      const failure = await fetchWithRetry({
        url: URL_UNDER_TEST,
        deadlineAtMs: Date.now() + 10_000,
      }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(HttpResponseError);
      expect(
        (failure as InstanceType<typeof HttpResponseError>).bodyText,
      ).toHaveLength(2_000);

      // The ceiling has to bound the READ, not just the string we keep: a
      // slice after response.text() would still have pulled all 5000 chunks.
      expect(chunksPulled).toBeLessThan(10);
    });
  });
});
