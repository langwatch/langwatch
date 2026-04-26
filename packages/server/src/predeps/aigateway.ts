import { execa } from "execa";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Predep } from "./types.ts";

// The Go AI Gateway monobinary is built per-platform in CI and uploaded
// to a GitHub release named v3.x.x-gateway. The CLI version is in lockstep
// with the release tag — see .github/workflows/npx-server-release.yml.
function downloadUrl(version: string, platform: string): string {
  const map: Record<string, string> = {
    "darwin-arm64": "darwin-arm64",
    "darwin-x64": "darwin-amd64",
    "linux-arm64": "linux-arm64",
    "linux-x64": "linux-amd64",
  };
  const slug = map[platform];
  if (!slug) throw new Error(`No aigateway build for ${platform}`);
  return `https://github.com/langwatch/langwatch/releases/download/v${version}/aigateway-${slug}`;
}

async function resolveVersion(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execa(bin, ["--version"], { reject: false });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export function makeAigatewayPredep(version: string): Predep {
  return {
    id: "aigateway",
    label: "ai-gateway (Go data plane)",
    required: true,

    async detect(paths) {
      const bundled = join(paths.bin, "aigateway");
      if (existsSync(bundled)) {
        const v = await resolveVersion(bundled);
        if (v) return { installed: true, version: v, resolvedPath: bundled };
        return { installed: true, version: "unknown", resolvedPath: bundled };
      }
      return { installed: false, reason: "ai-gateway monobinary not in ~/.langwatch/bin" };
    },

    async install({ platform, paths, task }) {
      mkdirSync(paths.bin, { recursive: true });
      const url = downloadUrl(version, platform);
      task.output = `downloading ${url}`;
      const out = join(paths.bin, "aigateway");
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`aigateway download failed: HTTP ${res.status}`);
      const fs = await import("node:fs");
      const stream = await import("node:stream/promises");
      await stream.pipeline(res.body as unknown as NodeJS.ReadableStream, fs.createWriteStream(out));
      chmodSync(out, 0o755);
      const v = (await resolveVersion(out)) ?? version;
      return { version: v, resolvedPath: out };
    },
  };
}
