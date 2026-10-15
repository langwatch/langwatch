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

  describe("given headers that arrive but a body that never ends", () => {
    it("still gives up on the body after 45 seconds", async () => {
      const stalledBody = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(stream) {
            init?.signal?.addEventListener("abort", () => stream.error(init.signal?.reason), {
              once: true,
            });
          },
        });
        return new Response(body, { status: 200 });
      });
      const response = await readTimeoutFetch({ fetch: stalledBody })("/api/trpc/dataset.getAll");
      const outcome = response.text().catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(45_000);

      expect(await outcome).toBeInstanceOf(ReadTimeoutError);
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
    let page: AbortController;
    let added: ReturnType<typeof vi.spyOn>;
    let removed: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      page = new AbortController();
      added = vi.spyOn(page.signal, "addEventListener");
      removed = vi.spyOn(page.signal, "removeEventListener");
    });

    it("leaves no listener on it once each read's body has been read", async () => {
      const answering = vi.fn<typeof globalThis.fetch>(async () => new Response("{}"));
      const send = readTimeoutFetch({ fetch: answering });

      await (await send("/api/trpc/a", { signal: page.signal })).text();
      await (await send("/api/trpc/b", { signal: page.signal })).text();

      expect(removed).toHaveBeenCalledTimes(added.mock.calls.length);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("leaves no listener on it when a read's body fails or is cancelled", async () => {
      const failing = readTimeoutFetch({
        fetch: async () =>
          new Response(
            new ReadableStream({
              pull: (controller) => controller.error(new Error("connection reset")),
            }),
          ),
      });
      const endless = readTimeoutFetch({ fetch: async () => new Response(new ReadableStream()) });

      await expect((await failing("/api/trpc/a", { signal: page.signal })).text()).rejects.toThrow(
        "connection reset",
      );
      await (await endless("/api/trpc/b", { signal: page.signal })).body?.cancel();

      expect(removed).toHaveBeenCalledTimes(added.mock.calls.length);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("given a response whose body is never read", () => {
    /** @scenario "A read with no answer gives up after 45 seconds" */
    it("drops its listener on the page's signal when the limit runs out", async () => {
      const page = new AbortController();
      const added = vi.spyOn(page.signal, "addEventListener");
      const removed = vi.spyOn(page.signal, "removeEventListener");
      const send = readTimeoutFetch({ fetch: async () => new Response(new ReadableStream()) });

      await send("/api/trpc/a", { signal: page.signal });
      await vi.advanceTimersByTimeAsync(45_000);

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
