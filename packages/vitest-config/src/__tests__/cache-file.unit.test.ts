import { mkdtempSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CacheFile } from "../module-loading-cache/cache-file.ts";

function cacheDir() {
  return mkdtempSync(join(tmpdir(), "module-loading-cache-file-"));
}

describe("CacheFile", () => {
  /** @scenario "An install starts a fresh cache" */
  it("starts empty under a new salt and removes the old file on save", () => {
    const dir = cacheDir();
    const before = new CacheFile({ dir, name: "sources", salt: "lockfile:1" });
    before.set("a", Buffer.from("1"));
    before.save();

    const after = new CacheFile({ dir, name: "sources", salt: "lockfile:2" });
    after.set("b", Buffer.from("2"));
    after.save();

    expect(after.get("a")).toBeUndefined();
    expect(readdirSync(dir)).toEqual([after.path.slice(dir.length + 1)]);
  });

  /** @scenario "A temporary file a killed worker left behind is removed once it is old" */
  it("removes a temporary file a killed worker left behind, once it is an hour old", () => {
    const dir = cacheDir();
    const cache = new CacheFile({ dir, name: "sources", salt: "s" });
    const abandoned = `${cache.path}.123.tmp`;
    const inFlight = `${cache.path}.456.tmp`;
    writeFileSync(abandoned, "");
    writeFileSync(inFlight, "");
    const twoHoursAgo = new Date(statSync(dir).mtimeMs - 2 * 60 * 60 * 1000);
    utimesSync(abandoned, twoHoursAgo, twoHoursAgo);

    cache.set("a", Buffer.from("1"));
    cache.save();

    expect(readdirSync(dir).toSorted()).toEqual(
      [cache.path, inFlight].map((path) => path.slice(dir.length + 1)).toSorted(),
    );
  });

  /** @scenario "Workers that save at once keep each other's entries" */
  it("merges what another worker saved since this one opened the file", () => {
    const dir = cacheDir();
    const first = new CacheFile({ dir, name: "resolutions", salt: "s" });
    const second = new CacheFile({ dir, name: "resolutions", salt: "s" });
    first.set("a", Buffer.from("1"));
    second.set("b", Buffer.from("2"));

    first.save();
    second.save();
    const reopened = new CacheFile({ dir, name: "resolutions", salt: "s" });

    expect(reopened.get("a")?.toString()).toBe("1");
    expect(reopened.get("b")?.toString()).toBe("2");
    expect(reopened.size).toBe(2);
  });
});
