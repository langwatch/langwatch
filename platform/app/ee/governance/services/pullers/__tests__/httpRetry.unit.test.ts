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
      return new Response(JSON.stringify(next.body ?? {}), {
        status: next.status,
        headers: { "content-type": "application/json", ...(next.headers ?? {}) },
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
    expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:10 GMT", now)).toBe(10_000);
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
