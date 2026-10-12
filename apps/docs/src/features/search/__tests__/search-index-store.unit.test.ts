import { afterEach, describe, expect, it, vi } from "vitest";

import { loadSearchIndex } from "../browser/search-index-store.ts";

const entry = { slug: "intro", title: "Intro", section: "", description: "", headings: [] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("when search opens more than once in one build", () => {
  /** @scenario "Reuse the parsed search index and retry a failed load" */
  it("fetches and parses the index once, under its build version", async () => {
    const fetch = vi.fn(async () => Response.json([entry]));
    vi.stubGlobal("fetch", fetch);
    const first = await loadSearchIndex({ build: "build-a" });
    const second = await loadSearchIndex({ build: "build-a" });
    expect(second).toBe(first);
    expect(first[0]?.match.title).toBe("intro");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/search-index.json?v=build-a", { credentials: "omit" });
  });

  /** @scenario "Reuse the parsed search index and retry a failed load" */
  it("forgets a failed load so retry fetches again", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(Response.json([{ slug: "invalid" }]))
      .mockResolvedValueOnce(Response.json([entry]));
    vi.stubGlobal("fetch", fetch);
    await expect(loadSearchIndex({ build: "build-b" })).rejects.toThrow("Search unavailable");
    await expect(loadSearchIndex({ build: "build-b" })).rejects.toThrow(/title/);
    await expect(loadSearchIndex({ build: "build-b" })).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
