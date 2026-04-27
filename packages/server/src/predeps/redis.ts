import { execa } from "execa";
import { createHash } from "node:crypto";
import { chmodSync, createReadStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import embedsVersions from "../../embeds.versions.json" with { type: "json" };
import { downloadWithProgress } from "./_download.ts";
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
  label: "redis-server",
  required: true,

  // Always use the embedded redis. NOT checking `which redis-server` —
  // a user with a system redis installed (debian's redis 6.x, brew's
  // 7.x, etc.) would otherwise have us spawn THEIR binary against our
  // config, risking version-drift surprises (renamed commands, default
  // changes, ACL behavior). Tarball is ~1.5MB so the cost of always
  // downloading is negligible vs. an unreproducible version mismatch.
  async detect(paths) {
    const bundled = join(paths.bin, "redis-server");
    if (existsSync(bundled)) {
      const v = await resolveVersion(bundled);
      if (v) return { installed: true, version: v, resolvedPath: bundled };
    }
    return { installed: false, reason: `not yet downloaded to ${paths.bin}/redis-server` };
  },

  async install({ platform, paths, task }) {
    mkdirSync(paths.bin, { recursive: true });
    const url = downloadUrl(platform);
    const tar = await import("tar");
    const tmp = join(paths.bin, `.redis-${REDIS_VERSION}-${platform}.tar.gz`);
    await downloadWithProgress(url, tmp, task, `downloading redis ${REDIS_VERSION}`);

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
    // Tarball contains redis-server + redis-cli at the root. Both are
    // needed: the supervisor uses redis-cli for the readiness probe.
    // sync: true so files are fully flushed before we chmod — async tar.x
    // resolved while redis-cli was still in-flight on a CI run, and the
    // subsequent chmodSync hit ENOENT. Sync extraction blocks until every
    // entry is on disk and stat-visible.
    tar.x({ sync: true, file: tmp, cwd: paths.bin });
    const serverBin = join(paths.bin, "redis-server");
    const cliBin = join(paths.bin, "redis-cli");
    if (!existsSync(serverBin) || !existsSync(cliBin)) {
      throw new Error(
        `redis tarball ${url} extracted incompletely — expected both redis-server and redis-cli, got ${[
          existsSync(serverBin) ? "redis-server" : null,
          existsSync(cliBin) ? "redis-cli" : null,
        ].filter(Boolean).join(", ") || "neither"}`,
      );
    }
    chmodSync(serverBin, 0o755);
    chmodSync(cliBin, 0o755);
    const version = (await resolveVersion(serverBin)) ?? "unknown";
    return { version, resolvedPath: serverBin };
  },
};
