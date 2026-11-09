import { describe, expect, it } from "vitest";

import { refreshStars, STARS_FRESH_MS } from "../browser/github-stars.ts";

const NOW = 1_800_000_000_000;

/* A window double with one GitHub link, browser storage and a scripted GitHub answer. */
function fakeWindow({
  cached = null,
  github = { ok: true, stars: 7000 },
}: {
  cached?: { count: number; at: number } | null;
  github?: { ok: boolean; stars?: unknown } | "offline";
} = {}) {
  const storage = new Map<string, string>();
  if (cached) storage.set("lw-docs:github-stars", JSON.stringify(cached));
  const count = { textContent: "5,000" };
  const wrapper = { hidden: false };
  const parts = new Map<string, object>([
    ["[data-docs-stars-count]", count],
    ["[data-docs-stars]", wrapper],
  ]);
  const link = {
    label: "GitHub, 5,000 stars",
    setAttribute: (_name: string, value: string) => {
      link.label = value;
    },
    querySelector: (selector: string) => parts.get(selector) ?? null,
  };
  const requests: string[] = [];
  const win = {
    document: { querySelectorAll: () => [link] },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    fetch: async (url: string) => {
      requests.push(url);
      if (github === "offline") throw new TypeError("Failed to fetch");
      return { ok: github.ok, json: async () => ({ stargazers_count: github.stars }) };
    },
  };
  return { win, link, count, wrapper, storage, requests };
}

describe("the live GitHub star count", () => {
  describe("when the browser has no count from the last hour", () => {
    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("asks GitHub once, shows the count and keeps it with the time it was read", async () => {
      const { win, link, count, storage, requests } = fakeWindow();
      await refreshStars({ win: win as never, now: NOW });
      expect(requests).toEqual(["https://api.github.com/repos/langwatch/langwatch"]);
      expect(count.textContent).toBe("7,000");
      expect(link.label).toBe("GitHub, 7,000 stars");
      expect(JSON.parse(storage.get("lw-docs:github-stars") ?? "")).toEqual({
        count: 7000,
        at: NOW,
      });
    });

    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("shows an older stored count at once on a page built without one, then the fresh one", async () => {
      const { win, count, requests, wrapper } = fakeWindow({
        cached: { count: 6500, at: NOW - STARS_FRESH_MS - 1 },
      });
      wrapper.hidden = true;
      const refreshed = refreshStars({ win: win as never, now: NOW });
      expect(count.textContent).toBe("6,500");
      await refreshed;
      expect(requests).toHaveLength(1);
      expect(count.textContent).toBe("7,000");
    });
  });

  describe("when the reader navigates while GitHub is still answering", () => {
    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("asks GitHub once", async () => {
      const { win, count, requests } = fakeWindow();
      await Promise.all([
        refreshStars({ win: win as never, now: NOW }),
        refreshStars({ win: win as never, now: NOW }),
      ]);
      expect(requests).toHaveLength(1);
      expect(count.textContent).toBe("7,000");
    });
  });

  describe("when the browser read the count within the hour", () => {
    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("shows the stored count without asking GitHub", async () => {
      const { win, count, requests } = fakeWindow({ cached: { count: 6900, at: NOW - 60_000 } });
      await refreshStars({ win: win as never, now: NOW });
      expect(requests).toEqual([]);
      expect(count.textContent).toBe("6,900");
    });
  });

  describe("when the build had no count", () => {
    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("reveals the count once GitHub answers", async () => {
      const { win, wrapper } = fakeWindow();
      wrapper.hidden = true;
      await refreshStars({ win: win as never, now: NOW });
      expect(wrapper.hidden).toBe(false);
    });
  });

  describe("when GitHub does not answer with a count", () => {
    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it.each([
      ["is offline", "offline" as const],
      ["refuses the request", { ok: false }],
      ["answers without a count", { ok: true, stars: "lots" }],
    ])("keeps the build's count when GitHub %s", async (_label, github) => {
      const { win, count } = fakeWindow({ github });
      await refreshStars({ win: win as never, now: NOW });
      expect(count.textContent).toBe("5,000");
    });

    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("waits the hour before asking again", async () => {
      const { win, requests } = fakeWindow({ github: { ok: false } });
      await refreshStars({ win: win as never, now: NOW });
      await refreshStars({ win: win as never, now: NOW + STARS_FRESH_MS - 1 });
      expect(requests).toHaveLength(1);
      await refreshStars({ win: win as never, now: NOW + STARS_FRESH_MS });
      expect(requests).toHaveLength(2);
    });

    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("never puts an older stored count over the build's", async () => {
      const { win, count, requests } = fakeWindow({
        cached: { count: 4000, at: NOW - STARS_FRESH_MS },
        github: { ok: false },
      });
      await refreshStars({ win: win as never, now: NOW });
      await refreshStars({ win: win as never, now: NOW + 1 });
      expect(count.textContent).toBe("5,000");
      expect(requests).toHaveLength(1);
    });

    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("keeps a stored count it could not refresh on a page built without one", async () => {
      const { win, count, requests, wrapper } = fakeWindow({
        cached: { count: 6000, at: NOW - STARS_FRESH_MS },
        github: { ok: false },
      });
      wrapper.hidden = true;
      await refreshStars({ win: win as never, now: NOW });
      await refreshStars({ win: win as never, now: NOW + 1 });
      expect(count.textContent).toBe("6,000");
      expect(requests).toHaveLength(1);
    });
  });
});
