import { execa } from "execa";
import { createHash } from "node:crypto";
import { chmodSync, createReadStream, createWriteStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import embedsVersions from "../../embeds.versions.json" with { type: "json" };
import type { Predep } from "./types.ts";

// Embedded redis-server is built from upstream redis.io source against
// musl/glibc per platform by .github/workflows/embedded-binaries-publish.yml
// and uploaded to https://embeds.langwatch.ai. The tarball ships only the
// redis-server binary (we don't need redis-cli for the runtime) plus a
// .sha256 sidecar.
//
// Pinned to 7.4.x (BSD-3-Clause). Redis 8.x switched to AGPLv3 + RSAL —
// keeping 7.4 sidesteps the licensing implications of redistributing a
// dual-licensed AGPL/RSAL binary inside a self-hostable tarball.
const REDIS_VERSION = embedsVersions.redis.version;
const EMBEDS_BASE = "https://embeds.langwatch.ai";

function downloadUrl(platform: string): string {
  return `${EMBEDS_BASE}/redis-${REDIS_VERSION}-${platform}.tar.gz`;
}

async function resolveVersion(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execa(bin, ["--version"], { reject: false });
    return stdout.trim().split(" ").slice(0, 4).join(" ") || null;
  } catch {
    return null;
  }
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
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
    task.output = `downloading redis ${REDIS_VERSION} (${platform}) from embeds.langwatch.ai`;
    const tar = await import("tar");
    const tmp = join(paths.bin, `.redis-${REDIS_VERSION}-${platform}.tar.gz`);

    const res = await fetch(url);
    if (!res.ok || !res.body) {
      throw new Error(`redis download failed (${url}): HTTP ${res.status}`);
    }
    await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(tmp));

    task.output = "verifying sha256";
    const expectedRes = await fetch(`${url}.sha256`);
    if (!expectedRes.ok) {
      throw new Error(`redis sha256 sidecar missing (${url}.sha256): HTTP ${expectedRes.status}`);
    }
    const expected = (await expectedRes.text()).trim().split(/\s+/)[0]!;
    const actual = await sha256OfFile(tmp);
    if (expected !== actual) {
      throw new Error(
        `redis sha256 mismatch for ${platform}: expected ${expected}, got ${actual}. Refusing to install — the tarball at ${url} may be tampered or partially downloaded.`,
      );
    }

    task.output = "extracting";
    // Tarball contains a single redis-server binary at the root.
    await tar.x({ file: tmp, cwd: paths.bin });
    chmodSync(join(paths.bin, "redis-server"), 0o755);
    const version = (await resolveVersion(join(paths.bin, "redis-server"))) ?? "unknown";
    return { version, resolvedPath: join(paths.bin, "redis-server") };
  },
};
