import { execa } from "execa";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import embedsVersions from "../../embeds.versions.json" with { type: "json" };
import { downloadWithProgress } from "./_download.ts";
import type { Predep } from "./types.ts";

// Embedded postgres tarballs are built nightly by .github/workflows/
// embedded-binaries-publish.yml from the upstream postgresql.org source for
// every supported platform (darwin/linux × x64/arm64, plus linux musl) and
// uploaded to https://embeds.langwatch.ai. Each tarball ships with a
// `.sha256` sidecar so this step is verifiable.
const PG_VERSION = embedsVersions.postgres.version;
const PG_MAJOR = PG_VERSION.split(".")[0]!;
const EMBEDS_BASE = "https://embeds.langwatch.ai";

function downloadUrl(platform: string): string {
  return `${EMBEDS_BASE}/postgres-${PG_VERSION}-${platform}.tar.gz`;
}

async function resolveVersion(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execa(bin, ["--version"], { reject: false });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

export const postgresPredep: Predep = {
  id: "postgres",
  label: `postgresql ${PG_MAJOR}`,
  required: true,

  async detect(paths) {
    // LANGWATCH_FORCE_BUNDLED_POSTGRES=1 skips system-postgres detection so
    // the bundled tarball path is exercised. Use case: dogfooding the
    // bundled binary on machines that have brew/apt postgres on PATH (mac
    // dev machines, GitHub runners) — without this we'd always reuse the
    // host install and never test the bundled lifecycle. Empty / unset /
    // "0" / "false" all mean default behavior.
    const forceBundled = /^(1|true|yes)$/i.test(process.env.LANGWATCH_FORCE_BUNDLED_POSTGRES ?? "");
    const bundled = join(paths.bin, "postgres", "bin", "postgres");
    if (existsSync(bundled)) {
      const v = await resolveVersion(bundled);
      if (v) return { installed: true, version: v, resolvedPath: bundled };
    }
    if (forceBundled) {
      return { installed: false, reason: "LANGWATCH_FORCE_BUNDLED_POSTGRES=1 — skipping system postgres; bundled tarball will be downloaded" };
    }
    try {
      const { stdout } = await execa("which", ["postgres"], { reject: false });
      const path = stdout.trim();
      if (path) {
        const v = await resolveVersion(path);
        // Accept any postgres major on PATH that reports a version. The
        // langwatch app's prisma schema works on pg14+, so we don't force
        // the user to also install pg${PG_MAJOR} when their distro/brew
        // already provides pg14/15/16/17/18. We only download our pinned
        // major when nothing is on PATH.
        if (v && v.startsWith("postgres (PostgreSQL)")) {
          return { installed: true, version: v, resolvedPath: path };
        }
      }
    } catch {
      // ignore
    }
    return { installed: false, reason: "postgres not on PATH or in ~/.langwatch/bin/postgres" };
  },

  async install({ platform, paths, task }) {
    const target = join(paths.bin, "postgres");
    mkdirSync(target, { recursive: true });
    const url = downloadUrl(platform);
    const tar = await import("tar");
    const tmp = join(paths.bin, `.postgres-${PG_VERSION}-${platform}.tar.gz`);
    await downloadWithProgress(url, tmp, task, `downloading postgres ${PG_VERSION}`);

    task.output = "verifying sha256";
    const expectedRes = await fetch(`${url}.sha256`);
    if (!expectedRes.ok) {
      throw new Error(`postgres sha256 sidecar missing (${url}.sha256): HTTP ${expectedRes.status}`);
    }
    // sidecar format: "<hex>  <filename>\n" (sha256sum default), tolerate
    // bare hex too in case the publish workflow ever drops the filename.
    const expected = (await expectedRes.text()).trim().split(/\s+/)[0]!;
    const actual = await sha256OfFile(tmp);
    if (expected !== actual) {
      throw new Error(
        `postgres sha256 mismatch for ${platform}: expected ${expected}, got ${actual}. Refusing to install — the tarball at ${url} may be tampered or partially downloaded.`,
      );
    }

    task.output = "extracting";
    // Tarball layout: bin/, lib/, share/, include/ rooted at the tarball
    // top — matches what publish.yml produces with `tar czf ... -C prefix .`.
    // sync: true to avoid races between extract completion and downstream
    // file checks (the postgres tarball has 2000+ entries; async resolve
    // can return before the final entries are stat-visible on slow CI fs).
    tar.x({ sync: true, file: tmp, cwd: target });
    const bin = join(target, "bin", "postgres");
    if (!existsSync(bin)) {
      throw new Error(`postgres tarball ${url} extracted incompletely — ${bin} not found after extract`);
    }
    const version = (await resolveVersion(bin)) ?? "unknown";
    return { version, resolvedPath: bin };
  },
};
