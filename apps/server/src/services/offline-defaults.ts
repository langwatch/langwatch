import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";

import type { LangwatchPaths } from "../shared/paths.ts";
import { execAndPipe } from "./_pipe-to-bus.ts";
import type { EventBus } from "./event-bus.ts";

/**
 * Defaults that keep an install to the license sync and the usage report,
 * like the images and the chart. Spread first, so the user's .env wins;
 * FORCED_ENV is spread last and has no override.
 */

/**
 * Prisma's version check to checkpoint.prisma.io, which LangWatch never uses. And pnpm's check
 * before `pnpm run`: the prebuilt app, like the image, carries no pnpm-workspace.yaml, so the
 * check fails on catalog: specifiers and tries to install (ADR-180).
 */
export const FORCED_ENV = {
  CHECKPOINT_DISABLE: "1",
  pnpm_config_verify_deps_before_run: "false",
} as const;

type OfflineCachePaths = {
  /** Every tiktoken encoding file, read by the app through TIKTOKENS_PATH. */
  tiktokenEncodings: string;
  /** tiktoken's Python cache for LangEvals (TIKTOKEN_CACHE_DIR). */
  tiktokenCache: string;
};

/** Where dev/scripts/build-app-archive.sh puts the tokenizer files inside the prebuilt app. */
const SHIPPED_ENCODINGS_DIR = "tiktoken";
const SHIPPED_LANGEVALS_CACHE_DIR = "tiktoken-python";

type OfflineCacheInput = { paths: Pick<LangwatchPaths, "root">; appRootDir: string };

/** The prebuilt app ships both tokenizer directories (ADR-180); a checkout fills the cache. */
function offlineCachePaths({ paths, appRootDir }: OfflineCacheInput): OfflineCachePaths {
  const shipped = (dir: string, fallback: string) => {
    const inApp = join(appRootDir, dir);
    return existsSync(inApp) ? inApp : join(paths.root, "cache", fallback);
  };
  return {
    tiktokenEncodings: shipped(SHIPPED_ENCODINGS_DIR, "tiktoken-encodings"),
    tiktokenCache: shipped(SHIPPED_LANGEVALS_CACHE_DIR, "tiktoken"),
  };
}

/**
 * Defaults for the app, the workers and the migrations. Node's compile cache keeps the
 * compiled modules between starts, so a second start skips most of the compile.
 */
export function appOfflineEnv(input: OfflineCacheInput): Record<string, string> {
  return {
    TIKTOKENS_PATH: offlineCachePaths(input).tiktokenEncodings,
    NODE_COMPILE_CACHE: join(input.paths.root, "cache", "node-compile"),
  };
}

/**
 * Defaults for LangEvals. LiteLLM points tiktoken at CUSTOM_TIKTOKEN_CACHE_DIR
 * when it is imported, so both cache variables carry the same directory.
 */
export function langevalsOfflineEnv({
  paths,
  appRootDir,
}: OfflineCacheInput): Record<string, string> {
  const cache = offlineCachePaths({ paths, appRootDir }).tiktokenCache;
  return {
    RAGAS_DO_NOT_TRACK: "true",
    LANGWATCH_MODEL_PRICING_DIR: join(
      appRootDir,
      "modules",
      "model-provider",
      "contract",
      "src",
      "catalog",
    ),
    TIKTOKEN_CACHE_DIR: cache,
    CUSTOM_TIKTOKEN_CACHE_DIR: cache,
  };
}

/**
 * The encoding files named in tiktoken's registry that `dir` does not hold
 * yet, by the basename the app's tokenizer reads them under.
 */
function missingTiktokenEncodings({
  dir,
  registryPath,
}: {
  dir: string;
  registryPath: string;
}): string[] {
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Record<string, unknown>;
  const files = new Set<string>();
  const collect = (node: Record<string, unknown>) => {
    for (const value of Object.values(node)) {
      if (typeof value === "string" && value.startsWith("https://")) {
        files.add(basename(value));
      } else if (value && typeof value === "object") {
        collect(value as Record<string, unknown>);
      }
    }
  };
  collect(registry);
  return [...files].filter((file) => !existsSync(join(dir, file)));
}

/**
 * How long a tokenizer fill may run before it is killed. A fill that stalls on
 * the network then fails like any other, and the install goes on.
 */
const PREPARE_TIMEOUT_MS = 5 * 60_000;

/**
 * Downloads the tiktoken encoding files once, as the image build does; the prebuilt app
 * already holds them. A failed download does not fail the install: the app fetches on first use.
 */
export async function ensureTiktokenEncodings({
  paths,
  bus,
  appRootDir,
}: {
  paths: Pick<LangwatchPaths, "root">;
  bus: EventBus;
  appRootDir: string;
}): Promise<void> {
  const service = "prepare:langwatch";
  const dir = offlineCachePaths({ paths, appRootDir }).tiktokenEncodings;
  // The prebuilt app ships the files; only a checkout fills its own cache.
  if (dir.startsWith(appRootDir)) return;
  // The package that depends on tiktoken, where the image runs the same script.
  const workerDir = join(appRootDir, "modules", "trace", "process");
  try {
    const registryPath = createRequire(join(workerDir, "package.json")).resolve(
      "tiktoken/registry.json",
    );
    if (missingTiktokenEncodings({ dir, registryPath }).length === 0) return;

    await execAndPipe({
      bus,
      service,
      bin: process.execPath,
      args: [join(appRootDir, "dev", "scripts", "download-tiktoken-encodings.mjs"), dir],
      logsDir: join(paths.root, "logs"),
      options: { cwd: workerDir, timeout: PREPARE_TIMEOUT_MS },
    });
  } catch (err) {
    bus.emit({
      type: "log",
      service,
      stream: "stderr",
      isNotice: true,
      line: `could not pre-download the tokenizer files, they will be fetched on first use: ${firstLine(err)}`,
    });
  }
}

function firstLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "";
}

/**
 * Fills LangEvals' tiktoken cache once per lockfile (a marker keyed on the lockfile hash),
 * unless the prebuilt app shipped it. A failed fill does not fail the install.
 */
export async function ensureLangevalsTiktokenCache({
  paths,
  appRootDir,
  bus,
  uvBin,
  projectDir,
  venvDir,
  lockFile,
}: OfflineCacheInput & {
  bus: EventBus;
  uvBin: string;
  projectDir: string;
  venvDir: string;
  lockFile: string;
}): Promise<void> {
  const service = "prepare:langevals";
  if (existsSync(join(appRootDir, SHIPPED_LANGEVALS_CACHE_DIR))) return;
  const cache = offlineCachePaths({ paths, appRootDir }).tiktokenCache;
  const marker = join(cache, ".filled");
  const expected = existsSync(lockFile)
    ? createHash("sha256").update(readFileSync(lockFile)).digest("hex")
    : "missing";
  const filled = existsSync(marker) ? readFileSync(marker, "utf8").trim() : "";
  if (filled === expected) return;
  try {
    mkdirSync(cache, { recursive: true });
    await execAndPipe({
      bus,
      service,
      bin: uvBin,
      logsDir: join(paths.root, "logs"),
      args: [
        "run",
        "--project",
        projectDir,
        "--no-sync",
        "python",
        "-c",
        "import tiktoken; [tiktoken.get_encoding(n) for n in tiktoken.list_encoding_names()]",
      ],
      options: {
        env: {
          ...process.env,
          UV_PROJECT_ENVIRONMENT: venvDir,
          TIKTOKEN_CACHE_DIR: cache,
        },
        timeout: PREPARE_TIMEOUT_MS,
      },
    });
    writeFileSync(marker, expected);
  } catch (err) {
    bus.emit({
      type: "log",
      service,
      stream: "stderr",
      isNotice: true,
      line: `could not pre-fill the tokenizer cache, encodings will be fetched on first use: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
