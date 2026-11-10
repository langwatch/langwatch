import { describe, expect, it, vi } from "vitest";

import { SharedDocumentationFetcher } from "../documentation-fetch.ts";

function fetcherOver({
  maxCacheEntries = 10,
  maxCacheBytes = 1024,
  clock = { now: 0 },
}: {
  maxCacheEntries?: number;
  maxCacheBytes?: number;
  clock?: { now: number };
}) {
  const network = vi.fn((input: Parameters<typeof fetch>[0]) =>
    Promise.resolve(
      new Response(`page ${String(input)}`, {
        status: 200,
        headers: { "content-type": "text/markdown" },
      }),
    ),
  );
  const fetcher = new SharedDocumentationFetcher({
    limits: { maxInFlight: 4, cacheTtlMs: 60_000, maxCacheEntries, maxCacheBytes },
    fetchImplementation: network,
    now: () => clock.now,
  });
  return { fetcher, network, clock };
}

describe("SharedDocumentationFetcher", () => {
  describe("when the same page is asked for again after its time to live", () => {
    it("fetches it again", async () => {
      const { fetcher, network, clock } = fetcherOver({});

      await fetcher.fetch({ kind: "langwatch", url: "a" });
      clock.now = 59_999;
      await fetcher.fetch({ kind: "langwatch", url: "a" });
      clock.now = 60_000;
      await fetcher.fetch({ kind: "langwatch", url: "a" });

      expect(network).toHaveBeenCalledTimes(2);
    });
  });

  describe("when more pages are cached than the entry limit", () => {
    it("drops the oldest first", async () => {
      const { fetcher, network } = fetcherOver({ maxCacheEntries: 2 });

      await fetcher.fetch({ kind: "langwatch", url: "a" });
      await fetcher.fetch({ kind: "langwatch", url: "b" });
      await fetcher.fetch({ kind: "langwatch", url: "c" });
      await fetcher.fetch({ kind: "langwatch", url: "c" });
      await fetcher.fetch({ kind: "langwatch", url: "a" });

      expect(network).toHaveBeenCalledTimes(4);
    });
  });

  describe("when a page is larger than the whole cache", () => {
    it("serves it without keeping it", async () => {
      const { fetcher, network } = fetcherOver({ maxCacheBytes: 10 });

      await fetcher.fetch({ kind: "langwatch", url: "a" });
      await fetcher.fetch({ kind: "langwatch", url: "a" });

      expect(network).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the URL is outside the docs", () => {
    it("refuses it before counting or fetching", async () => {
      const { fetcher, network } = fetcherOver({});

      await expect(
        fetcher.fetch({ kind: "langwatch", url: "https://attacker.example/docs/x.md" }),
      ).rejects.toThrow("https://langwatch.ai/docs/");
      expect(network).not.toHaveBeenCalled();
    });
  });
});
