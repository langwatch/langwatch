import { execa } from "execa";
import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { downloadWithProgress } from "./_download.ts";
import type { Predep, DetectionResult, InstallContext } from "./types.ts";

// Pinned pnpm version. Keep in lockstep with the root package.json's
// `packageManager` field — both control which pnpm we expect dev tooling
// + npx-server to use.
const PNPM_VERSION = "10.24.0";

// Standalone-binary URL pattern published by pnpm/pnpm releases.
// linux-x64 / linux-arm64 are glibc; linuxstatic-* are fully static and
// work on Alpine/musl. macOS uses pnpm-macos-{x64,arm64}.
function downloadUrl(platform: string): string {
  const map: Record<string, string> = {
    "darwin-arm64": "macos-arm64",
    "darwin-x64": "macos-x64",
    "linux-arm64": "linux-arm64",
    "linux-x64": "linux-x64",
    "linux-arm64-musl": "linuxstatic-arm64",
    "linux-x64-musl": "linuxstatic-x64",
  };
  const slug = map[platform];
  if (!slug) throw new Error(`pnpm: unsupported platform ${platform}`);
  return `https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-${slug}`;
}

async function resolveVersion(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execa(bin, ["--version"], { reject: false });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export const pnpmPredep: Predep = {
  id: "pnpm",
  label: `pnpm ${PNPM_VERSION}`,
  required: true,

  async detect(paths): Promise<DetectionResult> {
    // Only accept our own bundled binary. We don't fall through to a
    // user's system pnpm here because version drift between the
    // bundled-bin and the lockfile's `packageManager` field can produce
    // confusing install failures (`ERR_PNPM_BAD_PM_VERSION`). The
    // resolvePnpm() helper handles dev-machine PATH-pnpm separately for
    // local checkouts; in the npx flow we always want the pinned binary.
    const bundled = join(paths.bin, "pnpm");
    if (existsSync(bundled)) {
      const v = await resolveVersion(bundled);
      if (v === PNPM_VERSION) {
        return { installed: true, version: v, resolvedPath: bundled };
      }
      // Stale binary from an older PNPM_VERSION pin — fall through and
      // re-download. install() overwrites, so this is recoverable.
      return { installed: false, reason: `bundled pnpm ${v ?? "unknown"} != pinned ${PNPM_VERSION}` };
    }
    return { installed: false, reason: "bundled pnpm not yet installed" };
  },

  async install({ platform, paths, task }: InstallContext) {
    const url = downloadUrl(platform);
    const bin = join(paths.bin, "pnpm");
    await downloadWithProgress(url, bin, task, `downloading pnpm ${PNPM_VERSION}`);
    chmodSync(bin, 0o755);
    const version = (await resolveVersion(bin)) ?? "unknown";
    if (version !== PNPM_VERSION) {
      throw new Error(`pnpm install: downloaded binary reports v${version}, expected v${PNPM_VERSION}`);
    }
    return { version, resolvedPath: bin };
  },
};
