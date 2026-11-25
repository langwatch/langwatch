import { createHash, type Hash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { nowInstant } from "@langwatch/time";
import { z } from "zod";

/** Generated, installed, test-only and report folders: never read by a build, never walked. */
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  ".cache",
  ".git",
  ".turbo",
  "__tests__",
  "coverage",
  "storybook-static",
  "test-results",
  "playwright-report",
]);
/* Workspace packages the app declares only to run its tests; a renderer never imports them. */
const TEST_ONLY_PACKAGES = new Set(["@langwatch/vitest-config"]);
/* Repository files a build reads: the lockfile and catalogue, and the release notes. */
const ROOT_FILES = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "CHANGELOG.md"];
/* Reports a check writes into a finished build; they are not part of what it published. */
const DIAGNOSTIC_OUTPUTS = new Set(["link-report.json"]);
const manifestSchema = z.looseObject({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
});
const recordSchema = z.object({
  fingerprint: z.string(),
  output: z.record(z.string(), z.string()),
});
const KEPT_RECORDS = 8;
const FRESH_RECORD_MS = 60 * 60 * 1000;

/** Regular files under `directory`, relative and sorted; skips folders above and links. */
async function filesUnder({
  directory,
  excluded,
}: {
  directory: string;
  excluded: Set<string>;
}): Promise<string[]> {
  const files: string[] = [];
  const pending = [""];
  for (let folder = pending.pop(); folder !== undefined; folder = pending.pop()) {
    for (const entry of await readdir(path.join(directory, folder), { withFileTypes: true })) {
      const relative = path.join(folder, entry.name);
      const skipped =
        SKIPPED_DIRECTORIES.has(entry.name) || excluded.has(path.join(directory, relative));
      if (entry.isDirectory() && !skipped) pending.push(relative);
      else if (entry.isFile()) files.push(relative);
    }
  }
  return files.toSorted();
}

async function hashTree({
  hash,
  directory,
  label,
  excluded,
}: {
  hash: Hash;
  directory: string;
  label: string;
  excluded: Set<string>;
}) {
  for (const file of await filesUnder({ directory, excluded })) {
    hash.update(`\0${label}/${file}\0`).update(await readFile(path.join(directory, file)));
  }
}

/** A content digest of one source tree, skipping the folders above. */
export async function directoryDigest({ directory }: { directory: string }) {
  const hash = createHash("sha256");
  await hashTree({ hash, directory, label: "", excluded: new Set() });
  return hash.digest("hex");
}

/**
 * The app and the workspace packages its build reads, by real directory: every runtime and peer
 * dependency, transitively, and the app's own build-time workspace packages (not test tooling).
 * Installed third-party packages are covered by the lockfile instead.
 */
export function workspacePackages({
  appRoot,
  withBuildDependencies = true,
}: {
  appRoot: string;
  /** Also follow the starting package's own build-time workspace packages. */
  withBuildDependencies?: boolean;
}) {
  const found = new Set<string>([appRoot]);
  const pending = [appRoot];
  for (let directory = pending.pop(); directory; directory = pending.pop()) {
    const manifest = manifestSchema.parse(
      JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")),
    );
    const build = withBuildDependencies && directory === appRoot ? manifest.devDependencies : {};
    const specs = { ...manifest.dependencies, ...manifest.peerDependencies, ...build };
    for (const [name, spec] of Object.entries(specs)) {
      const linked = path.join(directory, "node_modules", name);
      const workspace = spec.startsWith("workspace:") && !TEST_ONLY_PACKAGES.has(name);
      if (!workspace || !existsSync(linked)) continue;
      const target = realpathSync(linked);
      if (!found.has(target)) pending.push(target);
      found.add(target);
    }
  }
  return [...found].toSorted();
}

/**
 * A content hash of everything a build reads: the docs source, the app and its workspace
 * packages, the lockfile and catalogue, Node and the build's options and public environment.
 * Contents are read every time, so an edit that keeps a file's modification time is seen.
 */
export async function buildFingerprint({
  appRoot,
  docsRoot,
  outDir,
  options,
}: {
  appRoot: string;
  docsRoot: string;
  /** The build's own output, never an input even when it lies inside the app. */
  outDir: string;
  options: Record<string, unknown>;
}) {
  const excluded = new Set([path.resolve(outDir)]);
  const repoRoot = path.resolve(appRoot, "../..");
  const environment = { node: process.version, platform: process.platform, arch: process.arch };
  const hash = createHash("sha256").update(JSON.stringify({ options, environment }));
  for (const file of ROOT_FILES) {
    const target = path.join(repoRoot, file);
    if (existsSync(target)) hash.update(`\0${file}\0`).update(await readFile(target));
  }
  await hashTree({ hash, directory: docsRoot, label: "docs", excluded });
  for (const directory of workspacePackages({ appRoot }))
    await hashTree({ hash, directory, label: path.relative(repoRoot, directory), excluded });
  return hash.digest("hex");
}

async function filesUnderOutput({ outDir }: { outDir: string }) {
  const entries = await readdir(outDir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(outDir, path.join(entry.parentPath, entry.name)))
    .filter((file) => !DIAGNOSTIC_OUTPUTS.has(file))
    .toSorted();
}

/** A content digest of every output file, so a missing, extra or corrupted file is noticed. */
async function outputDigests({ outDir }: { outDir: string }) {
  const digests: Record<string, string> = {};
  for (const file of await filesUnderOutput({ outDir })) {
    digests[file] = createHash("sha256")
      .update(await readFile(path.join(outDir, file)))
      .digest("hex");
  }
  return digests;
}

function sameOutput({
  left,
  right,
}: {
  left: Record<string, string>;
  right: Record<string, string>;
}) {
  const names = Object.keys(left);
  if (names.length !== Object.keys(right).length) return false;
  return names.every((name) => left[name] === right[name]);
}

/** A stored record, or null when it is missing, unparsable or malformed. */
async function readRecord({ file }: { file: string }) {
  try {
    const parsed = recordSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * What builds of each fingerprint wrote, keyed by fingerprint rather than directory, so a build
 * staged in one directory and renamed into place is still recognised as current there.
 */
export function buildRecords({ cacheDir }: { cacheDir: string }) {
  const fileOf = ({ fingerprint }: { fingerprint: string }) =>
    path.join(cacheDir, `${fingerprint.replace(/[^0-9a-f]/g, "").slice(0, 64)}.json`);
  return {
    /** Whether `outDir` holds exactly the files, byte for byte, a build of `fingerprint` wrote. */
    async isCurrent({ fingerprint, outDir }: { fingerprint: string; outDir: string }) {
      if (!existsSync(outDir)) return false;
      const stored = await readRecord({ file: fileOf({ fingerprint }) });
      if (stored?.fingerprint !== fingerprint) return false;
      /* A file removed while it is read means another build is writing here: not current. */
      const output = await outputDigests({ outDir }).catch(() => null);
      return output !== null && sameOutput({ left: stored.output, right: output });
    },
    async save({ fingerprint, outDir }: { fingerprint: string; outDir: string }) {
      await mkdir(cacheDir, { recursive: true });
      const file = fileOf({ fingerprint });
      const contents = JSON.stringify({ fingerprint, output: await outputDigests({ outDir }) });
      await writeFile(`${file}.${process.pid}.partial`, contents);
      await rename(`${file}.${process.pid}.partial`, file);
      await pruneRecords({ cacheDir });
    },
  };
}

/** When a record was written, or null when another build has just removed it. */
async function writtenAt({ file }: { file: string }) {
  const info = await stat(file).catch(() => null);
  return info?.mtimeMs ?? null;
}

/**
 * Keeps the most recently written records, enough for a root and a mounted build per branch,
 * and never one written in the last hour, so builds pruning at the same time spare each other.
 */
async function pruneRecords({ cacheDir }: { cacheDir: string }) {
  const names = (await readdir(cacheDir).catch(() => [])).filter((name) => name.endsWith(".json"));
  const records = await Promise.all(
    names.map(async (name) => ({
      name,
      written: await writtenAt({ file: path.join(cacheDir, name) }),
    })),
  );
  const present = records.filter(
    (record): record is { name: string; written: number } => record.written !== null,
  );
  const cutoff = nowInstant().epochMilliseconds - FRESH_RECORD_MS;
  const stale = present
    .toSorted((a, b) => b.written - a.written)
    .slice(KEPT_RECORDS)
    .filter((record) => record.written < cutoff);
  for (const { name } of stale) await rm(path.join(cacheDir, name), { force: true });
}
