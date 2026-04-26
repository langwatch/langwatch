import { execa } from "execa";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Predep } from "./types.ts";

// ClickHouse ships a single self-contained binary that auto-detects whether
// it's invoked as `clickhouse-server`, `clickhouse-client`, etc. Their
// official installer is just a curl that picks the right archive — we
// reproduce that here so we don't need to shell out to bash.
function downloadUrl(platform: string): string {
  const map: Record<string, string> = {
    "darwin-arm64": "https://builds.clickhouse.com/master/macos-aarch64/clickhouse",
    "darwin-x64": "https://builds.clickhouse.com/master/macos/clickhouse",
    "linux-arm64": "https://builds.clickhouse.com/master/aarch64/clickhouse",
    "linux-x64": "https://builds.clickhouse.com/master/amd64/clickhouse",
  };
  const url = map[platform];
  if (!url) throw new Error(`No clickhouse build for ${platform}`);
  return url;
}

async function resolveVersion(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execa(bin, ["--version"], { reject: false });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export const clickhousePredep: Predep = {
  id: "clickhouse",
  label: "clickhouse (analytics)",
  required: true,

  // Always use the embedded clickhouse. NOT checking `which clickhouse` —
  // version drift between a user's system clickhouse and the schema /
  // queries langwatch ships is the worst kind of surprise (silent column
  // type changes, renamed functions). Tarball is large (~360MB) but only
  // downloaded once into ~/.langwatch/bin and reused thereafter.
  async detect(paths) {
    const bundled = join(paths.bin, "clickhouse");
    if (existsSync(bundled)) {
      const v = await resolveVersion(bundled);
      if (v) return { installed: true, version: v, resolvedPath: bundled };
    }
    return { installed: false, reason: `not yet downloaded to ${paths.bin}/clickhouse` };
  },

  async install({ platform, paths, task }) {
    mkdirSync(paths.bin, { recursive: true });
    const url = downloadUrl(platform);
    task.output = `downloading ${url}`;
    const out = join(paths.bin, "clickhouse");
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`clickhouse download failed: HTTP ${res.status}`);
    const fs = await import("node:fs");
    const stream = await import("node:stream/promises");
    await stream.pipeline(res.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(out));
    chmodSync(out, 0o755);
    const version = (await resolveVersion(out)) ?? "unknown";
    return { version, resolvedPath: out };
  },
};
