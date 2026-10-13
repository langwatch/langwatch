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
 * Prisma's version check to checkpoint.prisma.io, made by every prisma
 * command. LangWatch never uses it, so it is off in every environment.
 */
export const FORCED_ENV = { CHECKPOINT_DISABLE: "1" } as const;

type OfflineCachePaths = {
  /** Every tiktoken encoding file, read by the app through TIKTOKENS_PATH. */
  tiktokenEncodings: string;
  /** tiktoken's Python cache for LangEvals (TIKTOKEN_CACHE_DIR). */
  tiktokenCache: string;
};

function offlineCachePaths(paths: Pick<LangwatchPaths, "root">): OfflineCachePaths {
  return {
    tiktokenEncodings: join(paths.root, "cache", "tiktoken-encodings"),
    tiktokenCache: join(paths.root, "cache", "tiktoken"),
  };
}

/** Defaults for the app, the workers and the migrations. */
export function appOfflineEnv(paths: Pick<LangwatchPaths, "root">): Record<string, string> {
  return {
    TIKTOKENS_PATH: offlineCachePaths(paths).tiktokenEncodings,
  };
}

/**
 * Defaults for LangEvals. LiteLLM points tiktoken at CUSTOM_TIKTOKEN_CACHE_DIR
 * when it is imported, so both cache variables carry the same directory.
 */
export function langevalsOfflineEnv({
  paths,
  appRootDir,
}: {
  paths: Pick<LangwatchPaths, "root">;
  appRootDir: string;
}): Record<string, string> {
  const cache = offlineCachePaths(paths).tiktokenCache;
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
 * Downloads the tiktoken encoding files once, as the image build does. A
 * failed download does not fail the install: the app fetches on first use.
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
  const dir = offlineCachePaths(paths).tiktokenEncodings;
  const workerDir = join(appRootDir, "apps", "worker");
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
      options: { cwd: workerDir, timeout: PREPARE_TIMEOUT_MS },
    });
  } catch (err) {
    bus.emit({
      type: "log",
      service,
      stream: "stderr",
      line: `could not pre-download the tokenizer files, they will be fetched on first use: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

/**
 * Fills LangEvals' tiktoken cache once per lockfile (a marker keyed on the
 * lockfile hash). A failed fill does not fail the install.
 */
export async function ensureLangevalsTiktokenCache({
  paths,
  bus,
  uvBin,
  projectDir,
  venvDir,
  lockFile,
}: {
  paths: Pick<LangwatchPaths, "root">;
  bus: EventBus;
  uvBin: string;
  projectDir: string;
  venvDir: string;
  lockFile: string;
}): Promise<void> {
  const service = "prepare:langevals";
  const cache = offlineCachePaths(paths).tiktokenCache;
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
      line: `could not pre-fill the tokenizer cache, encodings will be fetched on first use: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
