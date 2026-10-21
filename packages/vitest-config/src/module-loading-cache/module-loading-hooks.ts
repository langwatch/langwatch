import { type BigIntStats, statSync } from "node:fs";
import type { LoadFnOutput, LoadHookSync, ResolveHookContext, ResolveHookSync } from "node:module";
import { isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";

/** The two lookups the hooks read and write; `CacheFile` in a worker, a `Map` in a test. */
export interface ModuleCacheStore {
  get(key: string): Buffer | undefined;
  set(key: string, value: Buffer): void;
}

export interface ModuleLoadingCounts {
  resolveHits: number;
  resolveMisses: number;
  loadHits: number;
  loadMisses: number;
  loadStale: number;
}

const FORMATS: (string | undefined)[] = [
  undefined,
  "commonjs",
  "module",
  "json",
  "builtin",
  "wasm",
  "addon",
];
const LOADABLE = new Set<string | undefined>(["commonjs", "module", "json"]);
// Format byte, then size, mtime in nanoseconds and inode as u64 each.
const SOURCE_HEADER = 1 + 8 * 3;
const MAX_SOURCE = 8 * 1024 * 1024;

/**
 * A file inside an installed package. Dot directories under node_modules (`.vite`,
 * `.vitest-cache`, `.cache`) hold generated files and are left to Node; `.pnpm` is
 * not one, since its own nested node_modules is the last one in the path.
 */
export function isInstalledPackageFile(url: string): boolean {
  const at = url.lastIndexOf("/node_modules/");
  return url.startsWith("file://") && at >= 0 && url[at + "/node_modules/".length] !== ".";
}

/** A package name, the only specifier whose answer from project code depends on installs alone. */
function isPackageSpecifier(specifier: string): boolean {
  return /^[@\w]/.test(specifier) && !specifier.includes(":");
}

function encodeFormat(format: string | null | undefined): number {
  return Math.max(0, FORMATS.indexOf(format ?? undefined));
}

function sameFile(entry: Buffer, stat: BigIntStats): boolean {
  return (
    entry.readBigUInt64LE(1) === stat.size &&
    entry.readBigUInt64LE(9) === stat.mtimeNs &&
    entry.readBigUInt64LE(17) === stat.ino
  );
}

function signature(format: string | null | undefined, stat: BigIntStats): Buffer {
  const header = Buffer.alloc(SOURCE_HEADER);
  header[0] = encodeFormat(format);
  header.writeBigUInt64LE(stat.size, 1);
  header.writeBigUInt64LE(stat.mtimeNs, 9);
  header.writeBigUInt64LE(stat.ino, 17);
  return header;
}

function statOf(url: string): BigIntStats | undefined {
  return statSync(fileURLToPath(url), { bigint: true, throwIfNoEntry: false });
}

function resolutionKey(specifier: string, context: ResolveHookContext): string {
  const parent = context.parentURL ?? "";
  return [
    parent.slice(0, parent.lastIndexOf("/") + 1),
    specifier,
    context.conditions?.join(",") ?? "",
    context.importAttributes?.type ?? "",
  ].join("\0");
}

/** Only a lookup whose answer no project file can change: an install decides it alone. */
function keepsResolution(specifier: string, parentURL: string | undefined, url: string): boolean {
  if (!isInstalledPackageFile(url)) return false;
  return isInstalledPackageFile(parentURL ?? "") || isPackageSpecifier(specifier);
}

/** The cached source, when the file on disk is still the one it was read from. */
function freshSource({
  entry,
  url,
  format,
  counts,
}: {
  entry: Buffer | undefined;
  url: string;
  format: string | null | undefined;
  counts: ModuleLoadingCounts;
}): LoadFnOutput | undefined {
  const stat = entry && statOf(url);
  if (!entry || !stat) return undefined;
  if (!sameFile(entry, stat)) {
    counts.loadStale++;
    return undefined;
  }
  const cached = FORMATS[entry[0]!];
  if (format != null && format !== cached) return undefined;
  counts.loadHits++;
  return { format: cached, source: entry.toString("utf8", SOURCE_HEADER), shortCircuit: true };
}

/** The entry to keep for what Node just loaded, or nothing if it must not be kept. */
function sourceEntry(url: string, before: BigIntStats, result: LoadFnOutput): Buffer | undefined {
  if (result.source == null || !LOADABLE.has(result.format ?? undefined)) return undefined;
  const source =
    typeof result.source === "string"
      ? Buffer.from(result.source, "utf8")
      : Buffer.from(result.source as Uint8Array);
  const header = signature(result.format, before);
  const after = statOf(url);
  // A file written while Node read it is not kept: its source may match neither stat.
  if (source.length > MAX_SOURCE || !after || !sameFile(header, after)) return undefined;
  return Buffer.concat([header, source]);
}

/**
 * Resolve and load hooks that answer from the stores. A resolution is kept only when it
 * lands in an installed package, so it changes only on install, which renames the store.
 * A source is served only while the file's size, mtime and inode still match.
 */
export function createModuleLoadingHooks({
  resolutions,
  sources,
}: {
  resolutions: ModuleCacheStore;
  sources: ModuleCacheStore;
}): { resolve: ResolveHookSync; load: LoadHookSync; counts: ModuleLoadingCounts } {
  const counts = { resolveHits: 0, resolveMisses: 0, loadHits: 0, loadMisses: 0, loadStale: 0 };

  const resolve: ResolveHookSync = (specifier, context, nextResolve) => {
    if (specifier.startsWith("node:") || isBuiltin(specifier)) {
      return nextResolve(specifier, context);
    }
    const key = resolutionKey(specifier, context);
    const hit = resolutions.get(key);
    if (hit !== undefined) {
      counts.resolveHits++;
      return { url: hit.toString("utf8", 1), format: FORMATS[hit[0]!], shortCircuit: true };
    }
    const result = nextResolve(specifier, context);
    if (keepsResolution(specifier, context.parentURL, result.url)) {
      counts.resolveMisses++;
      const url = Buffer.from(result.url, "utf8");
      resolutions.set(key, Buffer.concat([Buffer.of(encodeFormat(result.format)), url]));
    }
    return result;
  };

  const load: LoadHookSync = (url, context, nextLoad) => {
    if (!isInstalledPackageFile(url)) return nextLoad(url, context);
    const entry = sources.get(url);
    const cached = freshSource({ entry, url, format: context.format, counts });
    if (cached) return cached;
    const before = statOf(url);
    const result = nextLoad(url, context);
    const kept = before && sourceEntry(url, before, result);
    if (kept) {
      sources.set(url, kept);
      counts.loadMisses++;
    }
    return result;
  };

  return { resolve, load, counts };
}
