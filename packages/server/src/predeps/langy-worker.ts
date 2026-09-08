import { execa } from "execa";
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupportedPlatform } from "../shared/platform.ts";
import { downloadWithProgress } from "./_download.ts";
import type { DetectionResult, Predep } from "./types.ts";

const BINARY_NAME = "langy-worker";
const RELEASE_MARKER = ".langy-worker-server-version";

export function langyWorkerAssetName(platform: SupportedPlatform): string {
  const supported: Partial<Record<SupportedPlatform, string>> = {
    "darwin-arm64": "darwin-arm64",
    "darwin-x64": "darwin-x64",
    "linux-arm64": "linux-arm64",
    "linux-x64": "linux-x64",
    "linux-arm64-musl": "linux-arm64-musl",
    "linux-x64-musl": "linux-x64-musl",
  };
  const assetPlatform = supported[platform];
  if (!assetPlatform) {
    throw new Error(`No langy-worker build for ${platform}`);
  }
  return `${BINARY_NAME}-${assetPlatform}`;
}

function downloadUrl(version: string, platform: SupportedPlatform): string {
  return `https://github.com/langwatch/langwatch/releases/download/v${version}/${langyWorkerAssetName(platform)}`;
}

function findRepoRoot(): string | null {
  let here: string;
  try {
    here = fileURLToPath(import.meta.url);
  } catch {
    here = __filename;
  }

  let directory = dirname(here);
  for (let depth = 0; depth < 6; depth++) {
    if (existsSync(join(directory, "services", "langyworker", "package.json"))) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

async function buildFromCheckout({
  repoRoot,
  platform,
  output,
}: {
  repoRoot: string;
  platform: SupportedPlatform;
  output: string;
}): Promise<void> {
  const target = platform.endsWith("-musl")
    ? `bun-${platform.replace("-musl", "")}-musl`
    : `bun-${platform}`;
  await execa(
    "bun",
    ["run", "scripts/build-binary.ts", `--target=${target}`, `--outfile=${output}`],
    {
      cwd: join(repoRoot, "services", "langyworker"),
      stdio: "pipe",
    },
  );
}

async function resolveVersion(binary: string): Promise<string | null> {
  try {
    const { stdout } = await execa(binary, ["--version"], {
      reject: false,
      timeout: 5_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export function makeLangyWorkerPredep({
  isEnabled,
  serverVersion,
}: {
  isEnabled: boolean;
  serverVersion: string;
}): Predep {
  return {
    id: "langy-worker",
    label: "langy assistant worker",
    required: false,

    async detect(paths): Promise<DetectionResult> {
      if (!isEnabled) {
        return { installed: true, version: "skipped", resolvedPath: "" };
      }

      const binary = join(paths.bin, BINARY_NAME);
      if (!existsSync(binary)) {
        return { installed: false, reason: `${BINARY_NAME} not in ~/.langwatch/bin` };
      }

      const marker = join(paths.bin, RELEASE_MARKER);
      const installedFor = existsSync(marker) ? readFileSync(marker, "utf8").trim() : "";
      if (serverVersion !== "0.0.0-dev" && installedFor !== serverVersion) {
        return {
          installed: false,
          reason: installedFor
            ? `${BINARY_NAME} belongs to server v${installedFor}, this release wants v${serverVersion}`
            : `${BINARY_NAME} has no server release marker`,
        };
      }

      const workerVersion = await resolveVersion(binary);
      if (!workerVersion) {
        return { installed: false, reason: `${BINARY_NAME} does not report a version` };
      }

      return { installed: true, version: workerVersion, resolvedPath: binary };
    },

    async install({ platform, paths, task }) {
      const binary = join(paths.bin, BINARY_NAME);
      const temporary = `${binary}.download`;
      const url = downloadUrl(serverVersion, platform);

      rmSync(temporary, { force: true });
      try {
        try {
          await downloadWithProgress(
            url,
            temporary,
            task,
            `downloading langy assistant worker for server ${serverVersion}`,
          );
        } catch (error) {
          const isMissingReleaseAsset = error instanceof Error && /HTTP 404/.test(error.message);
          const isDevBuildEnabled =
            process.env.LANGWATCH_LANGY_WORKER_DEV_BUILD === "1" ||
            process.env.LANGWATCH_AIGATEWAY_DEV_BUILD === "1";
          const repoRoot = isDevBuildEnabled ? findRepoRoot() : null;
          if (!isMissingReleaseAsset) {
            throw error;
          }
          if (!repoRoot) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new Error(
              `${reason}. ` +
                "A release must publish the matching worker asset. Developers running from a checkout can set LANGWATCH_LANGY_WORKER_DEV_BUILD=1.",
              { cause: error },
            );
          }

          task.output = "building langy-worker from local checkout";
          await buildFromCheckout({ repoRoot, platform, output: temporary });
        }
        chmodSync(temporary, 0o755);

        const workerVersion = await resolveVersion(temporary);
        if (!workerVersion) {
          throw new Error(`${BINARY_NAME} downloaded from ${url} does not report a version`);
        }

        renameSync(temporary, binary);
        writeFileSync(join(paths.bin, RELEASE_MARKER), `${serverVersion}\n`);
        return { version: workerVersion, resolvedPath: binary };
      } catch (error) {
        rmSync(temporary, { force: true });
        throw error;
      }
    },
  };
}
