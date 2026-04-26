import { execa } from "execa";
import { chmodSync, createWriteStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Predep } from "./types.ts";

// Goose runs the langwatch app's ClickHouse schema migrations
// (langwatch/src/server/clickhouse/goose.ts shells out to `goose` via
// `which`). Pinned to the same version compose.dev.yml uses so dev / prod /
// npx all run the same migration engine.
const GOOSE_VERSION = "v3.26.0";

// Goose ships static Go binaries on GitHub releases. The same `linux_x86_64`
// binary works on both glibc and musl distros (Go's default static linkage),
// so we don't need a musl variant. Same for darwin — universal Go builds.
function downloadUrl(platform: string): string {
  const map: Record<string, { os: string; arch: string }> = {
    "darwin-arm64":     { os: "darwin", arch: "arm64" },
    "darwin-x64":       { os: "darwin", arch: "x86_64" },
    "linux-arm64":      { os: "linux",  arch: "arm64" },
    "linux-x64":        { os: "linux",  arch: "x86_64" },
    "linux-arm64-musl": { os: "linux",  arch: "arm64" },
    "linux-x64-musl":   { os: "linux",  arch: "x86_64" },
  };
  const m = map[platform];
  if (!m) throw new Error(`No goose binary for ${platform}`);
  return `https://github.com/pressly/goose/releases/download/${GOOSE_VERSION}/goose_${m.os}_${m.arch}`;
}

async function resolveVersion(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execa(bin, ["-version"], { reject: false });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export const goosePredep: Predep = {
  id: "goose",
  label: "goose (clickhouse migrations runner)",
  required: true,

  async detect(paths) {
    const bundled = join(paths.bin, "goose");
    if (existsSync(bundled)) {
      const v = await resolveVersion(bundled);
      if (v) return { installed: true, version: v, resolvedPath: bundled };
    }
    try {
      const { stdout } = await execa("which", ["goose"], { reject: false });
      const path = stdout.trim();
      if (path) {
        const v = await resolveVersion(path);
        if (v) return { installed: true, version: v, resolvedPath: path };
      }
    } catch {
      // ignore
    }
    return { installed: false, reason: "goose not on PATH or in ~/.langwatch/bin" };
  },

  async install({ platform, paths, task }) {
    mkdirSync(paths.bin, { recursive: true });
    const url = downloadUrl(platform);
    const target = join(paths.bin, "goose");
    task.output = `downloading goose ${GOOSE_VERSION} (${platform}) from github.com/pressly/goose`;
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      throw new Error(`goose download failed (${url}): HTTP ${res.status}`);
    }
    await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(target));
    chmodSync(target, 0o755);
    const version = (await resolveVersion(target)) ?? "unknown";
    return { version, resolvedPath: target };
  },
};
