import { describe, expect, it, vi } from "vitest";

import { createSessionStore } from "../http-security.js";

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
