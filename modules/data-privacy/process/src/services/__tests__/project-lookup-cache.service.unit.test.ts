/** The per-project cache under the policy cache and the PII redaction model's organization read. */
import { describe, expect, it, vi } from "vitest";

import { ProjectLookupCacheService } from "../project-lookup-cache.service.ts";

function cacheAt(start = 0) {
  let now = start;
  const cache = ProjectLookupCacheService.create<string>({ ttlMs: 60_000, now: () => now });
  return { cache, advance: (ms: number) => (now += ms) };
}

describe("ProjectLookupCacheService", () => {
  describe("when a project is read again inside its time to live", () => {
    it("answers from the cache without reading", async () => {
      const { cache, advance } = cacheAt();
      const read = vi.fn(async () => "org_1");

      await cache.get("project_1", read);
      advance(59_999);
      const answer = await cache.get("project_1", read);

      expect(answer).toBe("org_1");
      expect(read).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the time to live has passed", () => {
    it("reads again", async () => {
      const { cache, advance } = cacheAt();
      const read = vi.fn(async () => "org_1");

      await cache.get("project_1", read);
      advance(60_000);
      await cache.get("project_1", read);

      expect(read).toHaveBeenCalledTimes(2);
    });
  });

  describe("when several reads of one project miss at once", () => {
    it("reads once and answers every caller", async () => {
      const { cache } = cacheAt();
      const read = vi.fn(async () => "org_1");

      const answers = await Promise.all([
        cache.get("project_1", read),
        cache.get("project_1", read),
        cache.get("project_2", read),
      ]);

      expect(answers).toEqual(["org_1", "org_1", "org_1"]);
      expect(read).toHaveBeenCalledTimes(2);
    });
  });

  describe("when a read fails", () => {
    it("keeps nothing, so the next call reads again", async () => {
      const { cache } = cacheAt();
      const read = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(new Error("database down"))
        .mockResolvedValueOnce("org_1");

      await expect(cache.get("project_1", read)).rejects.toThrow("database down");
      await expect(cache.get("project_1", read)).resolves.toBe("org_1");
      expect(read).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the cache is cleared while a read is in flight", () => {
    it("starts a fresh read for the next call", async () => {
      const { cache } = cacheAt();
      const read = vi.fn(async () => "org_1");

      const first = cache.get("project_1", read);
      cache.clear();
      await Promise.all([first, cache.get("project_1", read)]);

      expect(read).toHaveBeenCalledTimes(2);
    });
  });
});
