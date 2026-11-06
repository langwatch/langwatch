import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchStars } from "../compile/github-stars.ts";

let dir: string;
let cacheFile: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "docs-stars-"));
  cacheFile = path.join(dir, "docs-site/stars.json");
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

function githubAnswers({ ok, body }: { ok: boolean; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status: ok ? 200 : 403, json: async () => body })),
  );
}

function githubIsDown() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
}

function writeCache({ value }: { value: unknown }) {
  mkdirSync(path.dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(value));
}

describe("fetchStars", () => {
  describe("when GitHub answers with a count", () => {
    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("stamps the day GitHub reported it and keeps both in the cache", async () => {
      githubAnswers({ ok: true, body: { stargazers_count: 7000 } });
      const before = Date.now();
      const read = await fetchStars({ cacheFile });
      expect(read.count).toBe(7000);
      expect(read.at).toBeLessThanOrEqual(before);
      expect(read.at).toBeGreaterThan(before - 24 * 60 * 60 * 1000);
      expect((read.at ?? 1) % (24 * 60 * 60 * 1000)).toBe(0);
      expect(JSON.parse(readFileSync(cacheFile, "utf8"))).toEqual(read);
    });
  });

  describe("when the build has a GitHub token", () => {
    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("signs the request with it", async () => {
      githubAnswers({ ok: true, body: { stargazers_count: 7000 } });
      await fetchStars({ cacheFile, token: "build-token" });
      const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer build-token");
    });
  });

  describe("when the build has no GitHub token", () => {
    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("asks without signing", async () => {
      githubAnswers({ ok: true, body: { stargazers_count: 7000 } });
      await fetchStars({ cacheFile });
      const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
    });
  });

  describe("when GitHub refuses the build", () => {
    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("says so in the build log", async () => {
      githubAnswers({ ok: false, body: { message: "rate limited" } });
      await fetchStars({ cacheFile });
      expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
        expect.stringContaining("star count not read"),
      );
    });
  });

  describe("when GitHub is down and the cache holds a count with its time", () => {
    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("reads both back from the cache", async () => {
      writeCache({ value: { count: 6000, at: 1_800_000_000_000 } });
      githubIsDown();
      expect(await fetchStars({ cacheFile })).toEqual({ count: 6000, at: 1_800_000_000_000 });
    });
  });

  describe("when GitHub refuses and the cache was written before counts carried a time", () => {
    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("reads the count with no time, so the page asks GitHub", async () => {
      writeCache({ value: { count: 6000 } });
      githubAnswers({ ok: false, body: { message: "rate limited" } });
      expect(await fetchStars({ cacheFile })).toEqual({ count: 6000, at: null });
    });
  });

  describe("when the cache holds a time but no count", () => {
    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("drops the time with the count", async () => {
      writeCache({ value: { at: 1_800_000_000_000 } });
      githubIsDown();
      expect(await fetchStars({ cacheFile })).toEqual({ count: null, at: null });
    });
  });

  describe("when GitHub is down and there is no cache", () => {
    /** @scenario "Show the live GitHub star count, refreshed from the build's and kept for an hour" */
    it("knows neither", async () => {
      githubIsDown();
      expect(await fetchStars({ cacheFile })).toEqual({ count: null, at: null });
    });
  });
});
