import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReadTimeoutError, readTimeoutFetch } from "../query/read-timeout.ts";

/** A fetch that never answers, but rejects with the abort reason as a browser's fetch does. */
const silentFetch = vi.fn<typeof globalThis.fetch>(
  (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }),
);

describe("readTimeoutFetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    silentFetch.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a read the API does not answer", () => {
    /** @scenario "A read with no answer gives up after 45 seconds" */
    it("fails as timed out after 45 seconds", async () => {
      const read = readTimeoutFetch({ fetch: silentFetch })("/api/trpc/dataset.getAll");
      const outcome = read.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(45_000);

      expect(await outcome).toBeInstanceOf(ReadTimeoutError);
    });

    it("is still waiting just before the limit", async () => {
      let settled = false;
      void readTimeoutFetch({ fetch: silentFetch })("/api/trpc/dataset.getAll").catch(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(44_999);

      expect(settled).toBe(false);
    });
  });

  describe("given a read the page cancels", () => {
    /** @scenario "A read the page cancels is cancelled at once" */
    it("fails with the page's reason, not as timed out", async () => {
      const page = new AbortController();
      const read = readTimeoutFetch({ fetch: silentFetch })("/api/trpc/dataset.getAll", {
        signal: page.signal,
      });

      page.abort(new DOMException("left the page", "AbortError"));

      await expect(read).rejects.toMatchObject({ name: "AbortError" });
    });
  });

  describe("given a Request carrying its own signal", () => {
    it("still cancels when that Request's signal aborts", async () => {
      const page = new AbortController();
      const request = new Request("http://localhost/api/trpc/dataset.getAll", {
        signal: page.signal,
      });
      const read = readTimeoutFetch({ fetch: silentFetch })(request);

      page.abort(new DOMException("left the page", "AbortError"));

      await expect(read).rejects.toMatchObject({ name: "AbortError" });
    });
  });

  describe("given reads that share one long-lived signal", () => {
    it("leaves no listener on it once each read has settled", async () => {
      const page = new AbortController();
      const added = vi.spyOn(page.signal, "addEventListener");
      const removed = vi.spyOn(page.signal, "removeEventListener");
      const answering = vi.fn<typeof globalThis.fetch>(async () => new Response("{}"));
      const send = readTimeoutFetch({ fetch: answering });

      await send("/api/trpc/a", { signal: page.signal });
      await send("/api/trpc/b", { signal: page.signal });

      expect(removed).toHaveBeenCalledTimes(added.mock.calls.length);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("given a write the API has not answered", () => {
    /** @scenario "A write is never given a time limit" */
    it("sends it untouched, with no time limit", async () => {
      const init = { method: "POST", body: "{}" };
      let settled = false;
      void readTimeoutFetch({ fetch: silentFetch })("/api/trpc/dataset.upsert", init).catch(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(60_000);

      expect(settled).toBe(false);
      expect(silentFetch).toHaveBeenCalledWith("/api/trpc/dataset.upsert", init);
    });
  });
});
