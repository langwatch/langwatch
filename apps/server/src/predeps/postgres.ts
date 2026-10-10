import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import { execa } from "execa";
import * as tar from "tar";

import embedsVersions from "../../embeds.versions.json" with { type: "json" };
import type { LocalOrchestratorDevelopmentConfig } from "../platform/config/local-orchestrator.config.ts";
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

type PostgresDetection = Awaited<ReturnType<Predep["detect"]>>;

/**
 * Accepts any postgres major on PATH that reports a version: the app's prisma schema works on
 * pg14+, so the pinned major is downloaded only when nothing is on PATH.
 */
async function detectSystemPostgres(): Promise<PostgresDetection | null> {
  try {
    const { stdout } = await execa("which", ["postgres"], { reject: false });
    const path = stdout.trim();
    if (!path) return null;
    const v = await resolveVersion(path);
    if (v && v.startsWith("postgres (PostgreSQL)")) {
      return { installed: true, version: v, resolvedPath: path };
    }
  } catch {
    // ignore
  }
  return null;
}

/** The sidecar is `<hex>  <filename>` (sha256sum's default); bare hex is tolerated too. */
async function verifyTarballSha256({
  url,
  tmp,
  platform,
}: {
  url: string;
  tmp: string;
  platform: string;
}): Promise<void> {
  const expectedRes = await fetch(`${url}.sha256`);
  if (!expectedRes.ok) {
    throw new Error(`postgres sha256 sidecar missing (${url}.sha256): HTTP ${expectedRes.status}`);
  }
  const expected = (await expectedRes.text()).trim().split(/\s+/)[0]!;
  const actual = await sha256OfFile(tmp);
  if (expected !== actual) {
    throw new Error(
      `postgres sha256 mismatch for ${platform}: expected ${expected}, got ${actual}. Refusing to install — the tarball at ${url} may be tampered or partially downloaded.`,
    );
  }
}

export function makePostgresPredep(development: LocalOrchestratorDevelopmentConfig): Predep {
  return {
    id: "postgres",
    label: `postgresql ${PG_MAJOR}`,
    required: true,

    async detect(paths) {
      // LANGWATCH_FORCE_BUNDLED_POSTGRES=1 skips system-postgres detection,
      // to dogfood the bundled binary on machines with brew/apt postgres on
      // PATH — otherwise we'd never exercise the bundled lifecycle.
      const forceBundled = development.forceBundledPostgres;
      const bundled = join(paths.bin, "postgres", "bin", "postgres");
      if (existsSync(bundled)) {
        const v = await resolveVersion(bundled);
        if (v) return { installed: true, version: v, resolvedPath: bundled };
      }
      if (forceBundled) {
        return {
          installed: false,
          reason:
            "LANGWATCH_FORCE_BUNDLED_POSTGRES=1 — skipping system postgres; bundled tarball will be downloaded",
        };
      }
      return (
        (await detectSystemPostgres()) ?? {
          installed: false,
          reason: "postgres not on PATH or in ~/.langwatch/bin/postgres",
        }
      );
    },

    async install({ platform, paths, task }) {
      const target = join(paths.bin, "postgres");
      mkdirSync(target, { recursive: true });
      const url = downloadUrl(platform);
      const tmp = join(paths.bin, `.postgres-${PG_VERSION}-${platform}.tar.gz`);
      await downloadWithProgress({ url, tmp, task, prefix: `downloading postgres ${PG_VERSION}` });

      task.output = "verifying sha256";
      await verifyTarballSha256({ url, tmp, platform });

      task.output = "extracting";
      // Tarball layout: bin/, lib/, share/, include/ rooted at the tarball
      // top — matches what publish.yml produces with `tar czf ... -C prefix .`.
      // sync: true to avoid races between extract completion and downstream
      // file checks (the postgres tarball has 2000+ entries; async resolve
      // can return before the final entries are stat-visible on slow CI fs).
      tar.x({ sync: true, file: tmp, cwd: target });
      const bin = join(target, "bin", "postgres");
      if (!existsSync(bin)) {
        throw new Error(
          `postgres tarball ${url} extracted incompletely — ${bin} not found after extract`,
        );
      }
      const version = (await resolveVersion(bin)) ?? "unknown";
      return { version, resolvedPath: bin };
    },
  };
}
