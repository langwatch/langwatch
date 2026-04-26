import { execa } from "execa";
import { existsSync, mkdirSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Predep } from "./types.ts";

// EnterpriseDB publishes per-platform tarballs of the official PostgreSQL
// binaries (no service install, no postmaster pre-config) at:
//   https://get.enterprisedb.com/postgresql/postgresql-<ver>-<plat>-binaries.tar.gz
// We pin a major version so a `pnpm install` in the langwatch app's prisma
// migrations sees the same on-disk format every time.
const PG_MAJOR = "16";
const PG_VERSION = "16.6-1";

function downloadUrl(platform: string): string {
  const map: Record<string, string> = {
    "darwin-arm64": `https://sbp.enterprisedb.com/getfile.jsp?fileid=1259243`,
    "darwin-x64": `https://sbp.enterprisedb.com/getfile.jsp?fileid=1259237`,
    "linux-arm64": `https://sbp.enterprisedb.com/getfile.jsp?fileid=1259239`,
    "linux-x64": `https://sbp.enterprisedb.com/getfile.jsp?fileid=1259235`,
  };
  const url = map[platform];
  if (!url) throw new Error(`No postgres binaries for ${platform}`);
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

export const postgresPredep: Predep = {
  id: "postgres",
  label: `postgresql ${PG_MAJOR} (primary store)`,
  required: true,

  async detect(paths) {
    const bundled = join(paths.bin, "postgres", "bin", "postgres");
    if (existsSync(bundled)) {
      const v = await resolveVersion(bundled);
      if (v) return { installed: true, version: v, resolvedPath: bundled };
    }
    try {
      const { stdout } = await execa("which", ["postgres"], { reject: false });
      const path = stdout.trim();
      if (path) {
        const v = await resolveVersion(path);
        if (v && v.includes(`PostgreSQL) ${PG_MAJOR}`)) {
          return { installed: true, version: v, resolvedPath: path };
        }
      }
    } catch {
      // ignore
    }
    return { installed: false, reason: `postgresql ${PG_MAJOR} not on PATH or in ~/.langwatch/bin/postgres` };
  },

  async install({ platform, paths, task }) {
    const target = join(paths.bin, "postgres");
    mkdirSync(target, { recursive: true });
    const url = downloadUrl(platform);
    task.output = `downloading PostgreSQL ${PG_VERSION} from EnterpriseDB`;
    const tar = await import("tar");
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`postgres download failed: HTTP ${res.status}`);
    const tmp = join(paths.bin, `.postgres-${PG_VERSION}.tar.gz`);
    await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(tmp));
    task.output = "extracting";
    await tar.x({ file: tmp, cwd: target, strip: 1 });
    const bin = join(target, "bin", "postgres");
    const version = (await resolveVersion(bin)) ?? "unknown";
    return { version, resolvedPath: bin };
  },
};
