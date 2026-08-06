import { describe, expect, it, vi } from "vitest";

import {
  apiKeysMatch,
  createApiKeyVerifier,
  createRateLimiter,
  createSessionStore,
  DEFAULT_BIND_HOST,
  hashApiKey,
  isLoopbackHost,
  isOriginAllowed,
  parseAllowedOrigins,
} from "../http-security.js";

describe("bind host", () => {
  it("defaults to loopback", () => {
    expect(DEFAULT_BIND_HOST).toBe("127.0.0.1");
    expect(isLoopbackHost(DEFAULT_BIND_HOST)).toBe(true);
  });

  it.each(["127.0.0.1", "localhost", "::1", "[::1]", " LOCALHOST "])(
    "recognises %s as loopback",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    }
  );

  it.each(["0.0.0.0", "::", "192.168.1.10", "10.0.0.1", "example.com"])(
    "does not treat %s as loopback",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    }
  );
});

describe("parseAllowedOrigins", () => {
  it("returns an empty list when nothing is configured", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins("")).toEqual([]);
  });

  it("splits, trims, and normalizes entries", () => {
    expect(
      parseAllowedOrigins(" https://Example.com/ , https://app.test:8443 ")
    ).toEqual(["https://example.com", "https://app.test:8443"]);
  });

  it("drops entries that are not usable origins", () => {
    expect(parseAllowedOrigins("not-an-origin, https://ok.test")).toEqual([
      "https://ok.test",
    ]);
  });

  it("deduplicates equivalent origins", () => {
    expect(parseAllowedOrigins("https://a.test,https://a.test/")).toEqual([
      "https://a.test",
    ]);
  });
});

describe("isOriginAllowed", () => {
  it.each([
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "https://localhost",
  ])("always allows the loopback origin %s", (origin) => {
    expect(isOriginAllowed(origin, [])).toBe(true);
  });

  it("rejects an unlisted remote origin", () => {
    expect(isOriginAllowed("https://evil.test", [])).toBe(false);
  });

  it("allows a configured remote origin", () => {
    expect(isOriginAllowed("https://app.test", ["https://app.test"])).toBe(
      true
    );
  });

  it("matches on scheme, host and port together", () => {
    const allowlist = ["https://app.test"];
    expect(isOriginAllowed("http://app.test", allowlist)).toBe(false);
    expect(isOriginAllowed("https://app.test:8443", allowlist)).toBe(false);
    expect(isOriginAllowed("https://other.test", allowlist)).toBe(false);
  });

  it("does not let a hostname that merely ends in localhost through", () => {
    expect(isOriginAllowed("https://notlocalhost", [])).toBe(false);
    expect(isOriginAllowed("https://evil-localhost.test", [])).toBe(false);
  });

  it("rejects the opaque null origin", () => {
    expect(isOriginAllowed("null", [])).toBe(false);
  });

  it("treats a rebound attacker hostname as unlisted", () => {
    // DNS rebinding points an attacker hostname at loopback, but the browser
    // still sends the attacker hostname as the origin.
    expect(isOriginAllowed("http://rebind.attacker.test", [])).toBe(false);
  });
});

describe("apiKeysMatch", () => {
  it("matches identical keys", () => {
    expect(apiKeysMatch("sk-abc", "sk-abc")).toBe(true);
  });

  it("rejects different keys, including different lengths", () => {
    expect(apiKeysMatch("sk-abc", "sk-abd")).toBe(false);
    expect(apiKeysMatch("sk-abc", "sk-abc-longer")).toBe(false);
    expect(apiKeysMatch("", "sk-abc")).toBe(false);
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
      })
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
    const fetchImpl = vi.fn(async () => jsonResponse(200));
    const verifier = createApiKeyVerifier({
      endpoint: "https://app.langwatch.ai",
      positiveTtlMs: 5,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await verifier.verify("sk-real");
    await new Promise((resolve) => setTimeout(resolve, 15));
    await verifier.verify("sk-real");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
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

    const results = await Promise.all(
      Array.from({ length: 25 }, () => verifier.verify("sk-real"))
    );

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

  it("fails closed when the request throws", async () => {
    const verifier = createApiKeyVerifier({
      endpoint: "https://app.langwatch.ai",
      fetchImpl: (async () => {
        throw new Error("connection refused");
      }) as unknown as typeof fetch,
    });

    await expect(verifier.verify("sk-real")).resolves.toBe(false);
  });

  it("keeps the cache bounded when unique keys are sprayed at it", async () => {
    const verifier = createApiKeyVerifier({
      endpoint: "https://app.langwatch.ai",
      maxEntries: 10,
      negativeTtlMs: 60_000,
      fetchImpl: (async () => jsonResponse(401)) as unknown as typeof fetch,
    });

    for (let i = 0; i < 200; i++) {
      await verifier.verify(`sk-spray-${i}`);
    }

    // The last key is still cached, so the map is populated but capped rather
    // than holding one entry per attempt.
    const fetchImpl = vi.fn(async () => jsonResponse(401));
    const probe = createApiKeyVerifier({
      endpoint: "https://app.langwatch.ai",
      maxEntries: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await probe.verify("sk-spray-199");
    await probe.verify("sk-spray-199");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("createSessionStore", () => {
  function makeStore(maxAgeMs = 60_000) {
    const closed: string[] = [];
    const store = createSessionStore<{ id: string }>({
      maxAgeMs,
      closeTransport: (transport) => closed.push(transport.id),
    });
    return { store, closed };
  }

  it("stores and returns sessions bound to their key", () => {
    const { store } = makeStore();
    store.add("s1", { id: "s1" }, "sk-a");

    expect(store.get("s1")?.apiKey).toBe("sk-a");
    expect(store.size).toBe(1);
  });

  it("counts live sessions per key without holding the raw key", () => {
    const { store } = makeStore();
    store.add("s1", { id: "s1" }, "sk-a");
    store.add("s2", { id: "s2" }, "sk-a");
    store.add("s3", { id: "s3" }, "sk-b");

    expect(store.countForKey("sk-a")).toBe(2);
    expect(store.countForKey("sk-b")).toBe(1);
    expect(store.countForKey("sk-unknown")).toBe(0);
  });

  it("decrements the per-key count when a session is removed", () => {
    const { store } = makeStore();
    store.add("s1", { id: "s1" }, "sk-a");
    store.add("s2", { id: "s2" }, "sk-a");

    store.remove("s1");
    expect(store.countForKey("sk-a")).toBe(1);

    store.remove("s2");
    expect(store.countForKey("sk-a")).toBe(0);
  });

  it("ignores removal of a session it does not hold", () => {
    const { store } = makeStore();
    store.add("s1", { id: "s1" }, "sk-a");

    store.remove("never-existed");
    store.remove("never-existed");

    expect(store.countForKey("sk-a")).toBe(1);
  });

  it("closes and forgets sessions that have gone idle", () => {
    vi.useFakeTimers();
    try {
      const { store, closed } = makeStore(1_000);
      store.add("idle", { id: "idle" }, "sk-a");
      store.add("busy", { id: "busy" }, "sk-a");

      vi.advanceTimersByTime(900);
      store.touch("busy");
      vi.advanceTimersByTime(900);
      store.sweep();

      expect(closed).toEqual(["idle"]);
      expect(store.get("idle")).toBeUndefined();
      expect(store.get("busy")).toBeDefined();
      expect(store.countForKey("sk-a")).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes everything on shutdown", () => {
    const { store, closed } = makeStore();
    store.add("s1", { id: "s1" }, "sk-a");
    store.add("s2", { id: "s2" }, "sk-b");

    store.closeAll();

    expect(closed.sort()).toEqual(["s1", "s2"]);
    expect(store.size).toBe(0);
    expect(store.countForKey("sk-a")).toBe(0);
  });

  it("does not let a prototype-shaped session id reach the prototype chain", () => {
    const { store } = makeStore();

    expect(store.get("__proto__")).toBeUndefined();
    expect(store.get("constructor")).toBeUndefined();

    store.add("__proto__", { id: "weird" }, "sk-a");
    expect(store.get("__proto__")?.transport.id).toBe("weird");
    expect(store.size).toBe(1);
  });
});
