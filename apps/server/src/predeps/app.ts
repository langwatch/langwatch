import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import { execa } from "execa";

import type { LocalOrchestratorDevelopmentConfig } from "../platform/config/local-orchestrator.config.ts";
import { appVersionsInUse } from "../shared/app-in-use.ts";
import { APP_COMPLETE_MARKER, checkoutRoot, installedAppDir } from "../shared/app-location.ts";
import { withExclusiveLock } from "../shared/exclusive-lock.ts";
import type { LangwatchPaths } from "../shared/paths.ts";
import { downloadWithProgress, releaseAssetSlug, sha256OfFile } from "./_download.ts";
import type { DetectionResult, Predep, PredepTask } from "./types.ts";

// The prebuilt app, one archive per platform on the GitHub release v<version> beside the AI
// gateway binaries (ADR-180). No pnpm install and no build runs on the user's machine.
function releaseArchiveUrl({ version, platform }: { version: string; platform: string }): string {
  const slug = releaseAssetSlug(platform);
  if (!slug) throw new Error(`No prebuilt LangWatch app for ${platform}`);
  return `https://github.com/langwatch/langwatch/releases/download/v${version}/langwatch-app-${slug}.tar.gz`;
}

function isUrl(source: string): boolean {
  return /^https?:\/\//.test(source);
}

/** A checkout runs in place, but only once its developer has installed and built it. */
function detectCheckout(root: string): DetectionResult {
  if (!existsSync(join(root, "node_modules"))) {
    return {
      installed: false,
      reason: `checkout at ${root} has no node_modules: run \`pnpm install\` there`,
    };
  }
  if (!existsSync(join(root, "apps", "ui", "dist", "client", "index.html"))) {
    return {
      installed: false,
      reason: `checkout at ${root} is not built: run \`pnpm run build:server\` there`,
    };
  }
  return { installed: true, version: "checkout", resolvedPath: root };
}

export function makeAppPredep({
  version,
  development,
}: {
  version: string;
  development: Pick<LocalOrchestratorDevelopmentConfig, "appArchive">;
}): Predep {
  return {
    id: "app",
    label: "langwatch app",
    required: true,

    async detect(paths) {
      const checkout = checkoutRoot();
      if (checkout) return detectCheckout(checkout);
      const dir = installedAppDir({ appsDir: paths.app, version });
      if (existsSync(join(dir, APP_COMPLETE_MARKER))) {
        return { installed: true, version, resolvedPath: dir };
      }
      return {
        installed: false,
        reason: `the prebuilt app for v${version} is not in ${paths.app}`,
      };
    },

    async install({ platform, paths, task }) {
      const checkout = checkoutRoot();
      if (checkout) {
        const detection = detectCheckout(checkout);
        if (detection.installed) return detection;
        throw new Error(detection.reason);
      }
      const source = development.appArchive ?? releaseArchiveUrl({ version, platform });
      const dir = await installApp({ paths, version, source, task });
      return { version, resolvedPath: dir };
    },
  };
}

/**
 * Fetches the archive, verifies it against its `.sha256` file, extracts it beside the target and
 * renames it into place; then removes every other version no running LangWatch serves, and an
 * older CLI's flat tree. One run at a time holds the lock; nothing outside `paths.app` is touched.
 */
async function installApp({
  paths,
  version,
  source,
  task,
}: {
  paths: Pick<LangwatchPaths, "app" | "root" | "lockFile">;
  version: string;
  source: string;
  task: PredepTask;
}): Promise<string> {
  mkdirSync(paths.app, { recursive: true });
  const target = installedAppDir({ appsDir: paths.app, version });
  return withExclusiveLock({
    lockFile: paths.lockFile,
    onWait: (holder) => {
      task.output = `waiting for another LangWatch (pid ${holder}) to finish installing the app`;
    },
    run: async () => {
      // Another run may have installed this version while this one waited for the lock.
      if (!existsSync(join(target, APP_COMPLETE_MARKER))) {
        await unpackApp({ appsDir: paths.app, version, source, task, target });
      }
      removeOtherVersions({ paths, version });
      return target;
    },
  });
}

async function unpackApp({
  appsDir,
  version,
  source,
  task,
  target,
}: {
  appsDir: string;
  version: string;
  source: string;
  task: PredepTask;
  target: string;
}): Promise<void> {
  const staging = join(appsDir, `.extracting-${version}-${process.pid}`);
  const download = join(appsDir, `.download-${version}-${process.pid}.tar.gz`);
  const archive = isUrl(source) ? download : source;
  try {
    if (isUrl(source)) {
      await downloadWithProgress({
        url: source,
        tmp: download,
        task,
        prefix: `downloading langwatch app ${version}`,
      });
    }
    task.output = "verifying sha256";
    await verifyChecksum({ archive, source, version });

    task.output = "extracting";
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    // System tar: about four times faster than node-tar on the archive's ~75k files.
    await execa("tar", ["-xzf", archive, "-C", staging]);
    if (!existsSync(join(staging, APP_COMPLETE_MARKER))) {
      throw new Error(`app archive ${source} is incomplete: it carries no ${APP_COMPLETE_MARKER}`);
    }
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(download, { force: true });
  }
}

/** Every entry but this version and the ones a running LangWatch serves (shared/app-in-use.ts). */
function removeOtherVersions({
  paths,
  version,
}: {
  paths: Pick<LangwatchPaths, "app" | "root">;
  version: string;
}): void {
  const inUse = appVersionsInUse({ root: paths.root });
  for (const entry of readdirSync(paths.app)) {
    if (entry === version || inUse.has(entry)) continue;
    rmSync(join(paths.app, entry), { recursive: true, force: true });
  }
}

/** The archive against the `<source>.sha256` file published beside it. */
async function verifyChecksum({
  archive,
  source,
  version,
}: {
  archive: string;
  source: string;
  version: string;
}): Promise<void> {
  const expected = (await readSidecar(`${source}.sha256`)).trim().split(/\s+/)[0]?.toLowerCase();
  const actual = await sha256OfFile(archive);
  if (expected !== actual) {
    throw new Error(
      `app archive ${source} does not match its checksum (release v${version}): expected ${expected}, got ${actual}. Nothing was installed.`,
    );
  }
}

async function readSidecar(sidecar: string): Promise<string> {
  if (!isUrl(sidecar)) {
    if (!existsSync(sidecar)) throw new Error(`app archive checksum file missing: ${sidecar}`);
    return readFileSync(sidecar, "utf8");
  }
  const res = await fetch(sidecar);
  if (!res.ok)
    throw new Error(`app archive checksum file missing (${sidecar}): HTTP ${res.status}`);
  return res.text();
}
