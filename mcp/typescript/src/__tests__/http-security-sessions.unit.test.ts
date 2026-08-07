import { describe, expect, it, vi } from "vitest";

import { admitOAuthToken, createSessionStore } from "../http-security.js";

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
    store.add({ sessionId: "s1", transport: { id: "s1" }, apiKey: "sk-a" });

    expect(store.get("s1")?.apiKey).toBe("sk-a");
    expect(store.size).toBe(1);
  });

  it("counts live sessions per key without holding the raw key", () => {
    const { store } = makeStore();
    store.add({ sessionId: "s1", transport: { id: "s1" }, apiKey: "sk-a" });
    store.add({ sessionId: "s2", transport: { id: "s2" }, apiKey: "sk-a" });
    store.add({ sessionId: "s3", transport: { id: "s3" }, apiKey: "sk-b" });

    expect(store.countForKey("sk-a")).toBe(2);
    expect(store.countForKey("sk-b")).toBe(1);
    expect(store.countForKey("sk-unknown")).toBe(0);
  });

  it("decrements the per-key count when a session is removed", () => {
    const { store } = makeStore();
    store.add({ sessionId: "s1", transport: { id: "s1" }, apiKey: "sk-a" });
    store.add({ sessionId: "s2", transport: { id: "s2" }, apiKey: "sk-a" });

    store.remove("s1");
    expect(store.countForKey("sk-a")).toBe(1);

    store.remove("s2");
    expect(store.countForKey("sk-a")).toBe(0);
  });

  it("ignores removal of a session it does not hold", () => {
    const { store } = makeStore();
    store.add({ sessionId: "s1", transport: { id: "s1" }, apiKey: "sk-a" });

    store.remove("never-existed");
    store.remove("never-existed");

    expect(store.countForKey("sk-a")).toBe(1);
  });

  it("closes and forgets sessions that have gone idle", () => {
    vi.useFakeTimers();
    try {
      const { store, closed } = makeStore(1_000);
      store.add({ sessionId: "idle", transport: { id: "idle" }, apiKey: "sk-a" });
      store.add({ sessionId: "busy", transport: { id: "busy" }, apiKey: "sk-a" });

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
    store.add({ sessionId: "s1", transport: { id: "s1" }, apiKey: "sk-a" });
    store.add({ sessionId: "s2", transport: { id: "s2" }, apiKey: "sk-b" });

    store.closeAll();

    expect(closed.sort()).toEqual(["s1", "s2"]);
    expect(store.size).toBe(0);
    expect(store.countForKey("sk-a")).toBe(0);
  });

  it("does not let a prototype-shaped session id reach the prototype chain", () => {
    const { store } = makeStore();

    expect(store.get("__proto__")).toBeUndefined();
    expect(store.get("constructor")).toBeUndefined();

    store.add({ sessionId: "__proto__", transport: { id: "weird" }, apiKey: "sk-a" });
    expect(store.get("__proto__")?.transport.id).toBe("weird");
    expect(store.size).toBe(1);
  });
});

describe("session reservations", () => {
  function makeStore() {
    return createSessionStore<{ id: string }>({
      maxAgeMs: 60_000,
      closeTransport: () => undefined,
    });
  }

  it("counts a reserved slot before any session exists", () => {
    const store = makeStore();
    store.reserve("sk-a");

    // The point of the reservation: the cap sees the slot while the session is
    // still being set up.
    expect(store.countForKey("sk-a")).toBe(1);
    expect(store.size).toBe(0);
  });

  it("hands the reserved slot to the session rather than counting twice", () => {
    const store = makeStore();
    store.reserve("sk-a").commit({ sessionId: "s1", transport: { id: "s1" } });

    expect(store.countForKey("sk-a")).toBe(1);
    expect(store.get("s1")?.apiKey).toBe("sk-a");
  });

  it("returns the slot when the session never came up", () => {
    const store = makeStore();
    const reservation = store.reserve("sk-a");
    reservation.release();

    expect(store.countForKey("sk-a")).toBe(0);
  });

  it("ignores a release once the slot was committed", () => {
    const store = makeStore();
    const reservation = store.reserve("sk-a");
    reservation.commit({ sessionId: "s1", transport: { id: "s1" } });
    reservation.release();

    expect(store.countForKey("sk-a")).toBe(1);
    expect(store.get("s1")).toBeDefined();
  });

  it("frees the slot when the committed session is removed", () => {
    const store = makeStore();
    store.reserve("sk-a").commit({ sessionId: "s1", transport: { id: "s1" } });
    store.remove("s1");

    expect(store.countForKey("sk-a")).toBe(0);
  });
});

describe("admitOAuthToken", () => {
  function entry(apiKey: string, expiresAt: number) {
    return { apiKey, expiresAt };
  }

  it("evicts the oldest token for a key that is at the cap", () => {
    const tokens = new Map([
      ["t1", entry("sk-a", Date.now() + 1_000)],
      ["t2", entry("sk-a", Date.now() + 2_000)],
      ["t3", entry("sk-a", Date.now() + 3_000)],
    ]);

    admitOAuthToken({ apiKey: "sk-a", tokens, maxPerKey: 3 });

    // Room for the caller's new token, and the longest-standing one went.
    expect(tokens.has("t1")).toBe(false);
    expect([...tokens.keys()]).toEqual(["t2", "t3"]);
  });

  it("leaves other keys alone", () => {
    const tokens = new Map([
      ["t1", entry("sk-a", Date.now() + 1_000)],
      ["t2", entry("sk-b", Date.now() + 1_000)],
      ["t3", entry("sk-b", Date.now() + 2_000)],
    ]);

    admitOAuthToken({ apiKey: "sk-a", tokens, maxPerKey: 1 });

    expect(tokens.has("t1")).toBe(false);
    expect(tokens.has("t2")).toBe(true);
    expect(tokens.has("t3")).toBe(true);
  });

  it("keeps a key from growing the map without bound", () => {
    const tokens = new Map<string, { apiKey: string; expiresAt: number }>();

    for (let i = 0; i < 50; i += 1) {
      admitOAuthToken({ apiKey: "sk-a", tokens, maxPerKey: 10 });
      tokens.set(`t${i}`, entry("sk-a", Date.now() + 60_000 + i));
    }

    expect(tokens.size).toBe(10);
  });

  it("drops expired tokens for any key on the way past", () => {
    const tokens = new Map([
      ["stale", entry("sk-b", Date.now() - 1)],
      ["live", entry("sk-b", Date.now() + 60_000)],
    ]);

    admitOAuthToken({ apiKey: "sk-a", tokens, maxPerKey: 10 });

    expect(tokens.has("stale")).toBe(false);
    expect(tokens.has("live")).toBe(true);
  });
});
