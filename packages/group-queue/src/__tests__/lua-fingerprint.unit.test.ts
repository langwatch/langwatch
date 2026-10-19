import { createHash } from "node:crypto";
import type * as NodeCrypto from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ sources: [] as string[] }));

vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof NodeCrypto>();
  return {
    ...real,
    createHash: (algorithm: string, ...rest: unknown[]) => {
      const hash = (real.createHash as (...args: unknown[]) => ReturnType<typeof real.createHash>)(
        algorithm,
        ...rest,
      );
      if (algorithm !== "sha1") return hash;
      const update = hash.update.bind(hash) as (data: unknown, ...more: unknown[]) => unknown;
      Object.defineProperty(hash, "update", {
        value: (data: unknown, ...more: unknown[]) => {
          if (typeof data === "string") captured.sources.push(data);
          return update(data, ...more);
        },
      });
      return hash;
    },
  };
});

import * as root from "../index.ts";
import * as operational from "../operational.ts";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Argument names of every `new CachedLuaScript(...)` in non-test source. */
const EXPECTED_CACHED_SCRIPT_SOURCES = [
  "BLOB_SWEEP_LUA",
  "CLAIM_GUARD_LUA",
  "COMPLETE_LUA",
  "COUNT_LIVE_LUA",
  "COUNT_LISTED_OUTSTANDING_LUA",
  "DEAD_LETTER_JOB_LUA",
  "DISPATCH_BATCH_LUA",
  "DRAIN_GROUP_LUA",
  "INSPECT_PREFLIGHT_PAGE_LUA",
  "REFRESH_LUA",
  "REGISTER_PREFLIGHT_TARGETS_LUA",
  "RELEASE_CLAIM_LUA",
  "RELEASE_LUA",
  "RESTAGE_AND_BLOCK_LUA",
  "RETRY_RESTAGE_LUA",
  "STAGE_BATCH_LUA",
  "STAGE_LUA",
  "TAKE_LUA",
  "TRANSFER_LUA",
].toSorted();

/**
 * Exported `*_LUA` constants not reachable from a package entry;
 * hashed through their composers.
 */
const EXPECTED_UNREACHABLE_EXPORTED_LUA = [
  "BLOB_LEASE_HELPER_LUA",
  "CLAIMED_RECORD_HELPER_LUA",
  "GQ_BLOB_GRACE_LUA",
  "ROUTING_META_HELPER_LUA",
].toSorted();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__" || entry.name === "node_modules") return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

function scan(pattern: RegExp): string[] {
  return sourceFiles(srcDir)
    .flatMap((file) => [...readFileSync(file, "utf8").matchAll(pattern)].map((m) => m[1]!))
    .toSorted();
}

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

function exportedLuaConstants(): Record<string, string> {
  const found: Record<string, string> = {};
  for (const entry of [root, operational] as Record<string, unknown>[]) {
    for (const [name, value] of Object.entries(entry)) {
      if (name.endsWith("_LUA") && typeof value === "string") found[name] = value;
    }
  }
  return found;
}

const built = [...new Set(captured.sources)];

describe("group-queue Lua fingerprint", () => {
  describe("given every CachedLuaScript and exported Lua constant", () => {
    /** @scenario "Every Lua source keeps its fingerprint" */
    it("matches the committed name to sha1 map", () => {
      const map: Record<string, string> = {};
      for (const [name, source] of Object.entries(exportedLuaConstants())) {
        map[`const:${name}`] = sha1(source);
      }
      for (const source of built) {
        const head = source.split("\n").find((line) => line.trim() !== "") ?? "";
        map[`cached:${sha1(source)}`] = `${source.length}b ${head.trim().slice(0, 60)}`;
      }
      const sorted = Object.fromEntries(
        Object.entries(map).toSorted(([a], [b]) => a.localeCompare(b)),
      );

      expect(sorted).toMatchSnapshot();
    });
  });

  describe("given the explicit list of script construction sites", () => {
    /** @scenario "A Lua script added without being named fails the guard" */
    it("names every CachedLuaScript built in source", () => {
      expect(scan(/new CachedLuaScript\((\w+)\)/g)).toEqual(EXPECTED_CACHED_SCRIPT_SOURCES);
    });

    /** @scenario "A Lua script added without being named fails the guard" */
    it("builds exactly one distinct script per named site at runtime", () => {
      expect(built).toHaveLength(EXPECTED_CACHED_SCRIPT_SOURCES.length);
    });

    /** @scenario "A Lua script added without being named fails the guard" */
    it("names every exported Lua constant", () => {
      const reachable = Object.keys(exportedLuaConstants());
      const inSource = scan(/export const (\w+_LUA)\b/g);
      expect([...new Set(inSource)].toSorted()).toEqual(
        [...reachable, ...EXPECTED_UNREACHABLE_EXPORTED_LUA].toSorted(),
      );
    });
  });
});
