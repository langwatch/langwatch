import { mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CacheFile } from "../module-loading-cache/cache-file.ts";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function cacheDir() {
  const dir = mkdtempSync(join(tmpdir(), "module-loading-cache-file-"));
  created.push(dir);
  return dir;
}

describe("CacheFile", () => {
  /** @scenario "An install starts a fresh cache" */
  it("starts empty under a new salt and removes the old file on save", () => {
    const dir = cacheDir();
    const before = new CacheFile({ dir, name: "sources", salt: "lockfile:1" });
    before.set("a", Buffer.from("1"));
    before.save();

    const after = new CacheFile({ dir, name: "sources", salt: "lockfile:2" });
    expect(after.size).toBe(0);
    expect(after.get("a")).toBeUndefined();

    after.set("b", Buffer.from("2"));
    after.save();

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

  /** @scenario "A save keeps what other workers saved before it" */
  it("merges what another worker saved since this one opened the file", () => {
    const dir = cacheDir();
    const saver = new CacheFile({ dir, name: "resolutions", salt: "s" });
    const other = new CacheFile({ dir, name: "resolutions", salt: "s" });
    saver.set("a", Buffer.from("1"));
    other.set("b", Buffer.from("2"));
    other.save();

    saver.save();
    const reopened = new CacheFile({ dir, name: "resolutions", salt: "s" });

    expect(reopened.get("a")?.toString()).toBe("1");
    expect(reopened.get("b")?.toString()).toBe("2");
    expect(reopened.size).toBe(2);
  });

  /** @scenario "Entries no recent save touched are dropped" */
  it("drops an entry no save touched in the last keepForSaves, and keeps one a worker read", () => {
    const dir = cacheDir();
    const options = { dir, name: "sources", salt: "s", keepForSaves: 2 };
    const first = new CacheFile(options);
    first.set("stale", Buffer.from("old"));
    first.set("read", Buffer.from("hot"));
    first.save();

    for (const key of ["k2", "k3", "k4"]) {
      const worker = new CacheFile(options);
      expect(worker.get("read")?.toString()).toBe("hot");
      worker.set(key, Buffer.from(key));
      worker.save();
    }
    const reopened = new CacheFile(options);

    expect(reopened.get("stale")).toBeUndefined();
    expect(reopened.get("read")?.toString()).toBe("hot");
    expect(["k2", "k3", "k4"].map((key) => reopened.get(key)?.toString())).toEqual([
      "k2",
      "k3",
      "k4",
    ]);
  });

  /** @scenario "The cache file stays under its byte cap" */
  it("drops the least recently touched entries once the file would pass maxBytes", () => {
    const dir = cacheDir();
    const options = { dir, name: "sources", salt: "s", maxBytes: 1_500 };
    const first = new CacheFile(options);
    first.set("older", Buffer.alloc(1_000, 1));
    first.save();

    const second = new CacheFile(options);
    second.set("newer", Buffer.alloc(1_000, 2));
    second.save();
    const reopened = new CacheFile(options);

    expect(reopened.get("older")).toBeUndefined();
    expect(reopened.get("newer")).toEqual(Buffer.alloc(1_000, 2));
    expect(statSync(reopened.path).size).toBeLessThan(1_500);
  });
});
