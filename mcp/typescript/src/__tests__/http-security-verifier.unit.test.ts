import { describe, expect, it, vi } from "vitest";

import {
  apiKeysMatch,
  createApiKeyVerifier,
  createRateLimiter,
  hashApiKey,
} from "../http-security.js";

describe("apiKeysMatch", () => {
  it("matches identical keys", () => {
    expect(apiKeysMatch({ presentedKey: "sk-abc", expectedKey: "sk-abc" })).toBe(true);
  });

  it("rejects different keys, including different lengths", () => {
    expect(apiKeysMatch({ presentedKey: "sk-abc", expectedKey: "sk-abd" })).toBe(false);
    expect(apiKeysMatch({ presentedKey: "sk-abc", expectedKey: "sk-abc-longer" })).toBe(false);
    expect(apiKeysMatch({ presentedKey: "", expectedKey: "sk-abc" })).toBe(false);
  });
});

describe("hashApiKey", () => {
  it("never returns the raw key", () => {
    expect(hashApiKey("sk-secret")).not.toContain("sk-secret");
  });

  it("is stable and distinct per key", () => {
    expect(hashApiKey("a")).toBe(hashApiKey("a"));
    expect(hashApiKey("a")).not.toBe(hashApiKey("b"));
  });
});

describe("createRateLimiter", () => {
  it("blocks only after the limit is exceeded", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3 });

    expect(limiter.isBlocked("1.2.3.4")).toBe(false);
    limiter.track("1.2.3.4");
    limiter.track("1.2.3.4");
    expect(limiter.isBlocked("1.2.3.4")).toBe(false);
    limiter.track("1.2.3.4");
    expect(limiter.isBlocked("1.2.3.4")).toBe(true);
  });

  it("tracks each IP separately", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });

    limiter.track("1.1.1.1");
    expect(limiter.isBlocked("1.1.1.1")).toBe(true);
    expect(limiter.isBlocked("2.2.2.2")).toBe(false);
  });

  it("forgets an IP once its window has passed", () => {
    vi.useFakeTimers();
    try {
      const limiter = createRateLimiter({ windowMs: 1_000, maxRequests: 1 });
      limiter.track("1.1.1.1");
      expect(limiter.isBlocked("1.1.1.1")).toBe(true);

      vi.advanceTimersByTime(1_500);
      expect(limiter.isBlocked("1.1.1.1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

function jsonResponse(status: number): Response {
  return new Response(status === 200 ? "{}" : "", { status });
}

/** A fetch double that records the URL and init it was called with. */
function fetchStub(respond: () => Promise<Response>) {
  return vi.fn(async (_url: string, _init?: RequestInit) => respond());
}

describe("createApiKeyVerifier", () => {
  it("asks the LangWatch identity endpoint with the key in a header", async () => {
    const fetchImpl = fetchStub(async () => jsonResponse(200));
    const verifier = createApiKeyVerifier({
      endpoint: "https://app.langwatch.ai",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(verifier.verify("sk-real")).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://app.langwatch.ai/api/me/project",
      expect.objectContaining({
        method: "GET",
        headers: { "X-Auth-Token": "sk-real" },
      }),
    );
  });

  it("never puts the key in the URL", async () => {
    const fetchImpl = fetchStub(async () => jsonResponse(200));
    const verifier = createApiKeyVerifier({
      endpoint: "https://app.langwatch.ai",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await verifier.verify("sk-real");

    expect(fetchImpl.mock.calls[0]?.[0]).not.toContain("sk-real");
  });

  it.each([401, 403])("rejects a key the API answers %i for", async (status) => {
    const verifier = createApiKeyVerifier({
      endpoint: "https://app.langwatch.ai",
      fetchImpl: (async () => jsonResponse(status)) as unknown as typeof fetch,
    });

    await expect(verifier.verify("sk-fake")).resolves.toBe(false);
  });

  it("caches a positive answer instead of asking again", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200));
    const verifier = createApiKeyVerifier({
      endpoint: "https://app.langwatch.ai",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await verifier.verify("sk-real");
    await verifier.verify("sk-real");
    await verifier.verify("sk-real");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caches a negative answer so key spraying does not reach the API", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401));
    const verifier = createApiKeyVerifier({
      endpoint: "https://app.langwatch.ai",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await verifier.verify("sk-fake");
    await verifier.verify("sk-fake");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("re-asks once the cache entry has expired", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = fetchStub(async () => jsonResponse(200));
      const verifier = createApiKeyVerifier({
        endpoint: "https://app.langwatch.ai",
        positiveTtlMs: 1_000,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      await verifier.verify("sk-real");
      vi.advanceTimersByTime(1_500);
      await verifier.verify("sk-real");

      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("collapses concurrent checks of the same key into one request", async () => {
    const fetchImpl = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jsonResponse(200);
    });
    const verifier = createApiKeyVerifier({
      endpoint: "https://app.langwatch.ai",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const results = await Promise.all(Array.from({ length: 25 }, () => verifier.verify("sk-real")));

    expect(results.every((result) => result === true)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the API cannot answer, without caching the failure", async () => {
    let status = 503;
    const fetchImpl = vi.fn(async () => jsonResponse(status));
    const verifier = createApiKeyVerifier({
      endpoint: "https://app.langwatch.ai",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(verifier.verify("sk-real")).resolves.toBe(false);

    status = 200;
    await expect(verifier.verify("sk-real")).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up on an upstream that never answers", async () => {
    // Without a timeout the in-flight promise never settles and every request
    // for this key parks behind it until the socket dies.
    const verifier = createApiKeyVerifier({
      endpoint: "https://app.langwatch.ai",
      requestTimeoutMs: 20,
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as unknown as typeof fetch,
    });

    await expect(verifier.verify("sk-real")).resolves.toBe(false);
  });

  it("fails closed when the request throws", async () => {
    const verifier = createApiKeyVerifier({
      endpoint: "https://app.langwatch.ai",
      fetchImpl: (async () => {
        throw new Error("connection refused");
      }) as unknown as typeof fetch,
    });

    await expect(verifier.verify("sk-real")).resolves.toBe(false);
  });

  it("evicts old entries rather than growing once maxEntries is reached", async () => {
    const fetchImpl = fetchStub(async () => jsonResponse(401));
    const verifier = createApiKeyVerifier({
      endpoint: "https://app.langwatch.ai",
      maxEntries: 5,
      negativeTtlMs: 60_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    for (let i = 0; i < 20; i++) {
      await verifier.verify(`sk-spray-${i}`);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(20);

    // The newest key is still cached, so it costs nothing to re-check.
    await verifier.verify("sk-spray-19");
    expect(fetchImpl).toHaveBeenCalledTimes(20);

    // The oldest was evicted to keep the map bounded, so it has to be asked
    // again even though its negative TTL has not passed.
    await verifier.verify("sk-spray-0");
    expect(fetchImpl).toHaveBeenCalledTimes(21);
  });
});
