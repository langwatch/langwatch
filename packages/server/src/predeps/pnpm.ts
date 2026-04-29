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
    // Prefer our own bundled binary when present — exact-version pinned,
    // deterministic across re-runs.
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
    // Fall through to user's system pnpm if it's a 10.x — pnpm 10's
    // `manage-package-manager-versions: true` default handles the
    // `packageManager: pnpm@10.24.0` lockfile pin transparently across
    // patch versions (pnpm 10.30.x reads the field, self-fetches 10.24.0
    // into its own cache when needed, runs scripts with the right
    // version). This is the same pattern uv.ts uses for the host's uv.
    // Only download our bundled binary when no usable system pnpm exists
    // — the bare-Linux case the predep was originally added for.
    const sysVersion = await resolveVersion("pnpm");
    if (sysVersion && /^10\./.test(sysVersion)) {
      return { installed: true, version: sysVersion, resolvedPath: "pnpm" };
    }
    return { installed: false, reason: sysVersion
      ? `system pnpm ${sysVersion} is not 10.x — bundled pnpm ${PNPM_VERSION} required`
      : "no system pnpm on PATH; will install bundled" };
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
