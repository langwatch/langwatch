import { execa } from "execa";
import { chmodSync, createWriteStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Predep } from "./types.ts";

// We pull redis as a single statically-linked binary from the LangWatch
// releases bucket. The bucket is built nightly from the upstream Redis
// source against musl on linux and a CI-built clang on macOS, both stripped.
// It ships only redis-server (we don't need redis-cli for the runtime).
function downloadUrl(platform: string): string {
  const map: Record<string, string> = {
    "darwin-arm64": "https://releases.langwatch.ai/embedded/redis-7.4.1-darwin-arm64.tar.gz",
    "darwin-x64": "https://releases.langwatch.ai/embedded/redis-7.4.1-darwin-amd64.tar.gz",
    "linux-arm64": "https://releases.langwatch.ai/embedded/redis-7.4.1-linux-arm64.tar.gz",
    "linux-x64": "https://releases.langwatch.ai/embedded/redis-7.4.1-linux-amd64.tar.gz",
  };
  const url = map[platform];
  if (!url) throw new Error(`No embedded redis build for ${platform}`);
  return url;
}

async function resolveVersion(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execa(bin, ["--version"], { reject: false });
    return stdout.trim().split(" ").slice(0, 4).join(" ") || null;
  } catch {
    return null;
  }
}

export const redisPredep: Predep = {
  id: "redis",
  label: "redis-server (queue + fold cache backend)",
  required: true,

  async detect(paths) {
    const bundled = join(paths.bin, "redis-server");
    if (existsSync(bundled)) {
      const v = await resolveVersion(bundled);
      if (v) return { installed: true, version: v, resolvedPath: bundled };
    }
    try {
      const { stdout } = await execa("which", ["redis-server"], { reject: false });
      const path = stdout.trim();
      if (path) {
        const v = await resolveVersion(path);
        if (v) return { installed: true, version: v, resolvedPath: path };
      }
    } catch {
      // ignore
    }
    return { installed: false, reason: "redis-server not on PATH or in ~/.langwatch/bin" };
  },

  async install({ platform, paths, task }) {
    mkdirSync(paths.bin, { recursive: true });
    const url = downloadUrl(platform);
    task.output = `downloading ${url}`;
    const tar = await import("tar");
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`redis download failed: HTTP ${res.status}`);
    const tmp = join(paths.bin, ".redis.tar.gz");
    await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(tmp));
    task.output = "extracting";
    await tar.x({ file: tmp, cwd: paths.bin, strip: 1 });
    chmodSync(join(paths.bin, "redis-server"), 0o755);
    const version = (await resolveVersion(join(paths.bin, "redis-server"))) ?? "unknown";
    return { version, resolvedPath: join(paths.bin, "redis-server") };
  },
};
