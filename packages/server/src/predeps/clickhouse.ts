import { execa } from "execa";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as tar from "tar";
import { downloadWithProgress } from "./_download.ts";
import type { Predep } from "./types.ts";

// Pinned to a specific LTS tag rather than `master`. The previous
// `builds.clickhouse.com/master/...` URLs shipped whatever the trunk was
// at install time, and master rolled out an instruction (likely SVE/SME-
// related) that the CPU on a stock M1/M2 mac doesn't support — clickhouse
// crashed mid-query with SIGILL (exit 132). LTS releases are vetted for
// the supported instruction set and pinned here so an end user's install
// is reproducible across reboots.
const CH_VERSION = "25.8.22.28";

type Source =
  | { kind: "binary"; url: string }
  | { kind: "tarball"; url: string; pathInTar: string };

// LTS releases ship as:
//   - macos:   single self-contained binary at the GH release
//   - linux:   .tgz from the GH release containing
//              clickhouse-common-static-${VERSION}/usr/bin/clickhouse
// We treat both uniformly via a Source ADT; the tarball path strips the
// version-named root and a usr/bin/ prefix to land the binary at
// ~/.langwatch/bin/clickhouse.
function downloadSource(platform: string): Source {
  const releaseBase = `https://github.com/ClickHouse/ClickHouse/releases/download/v${CH_VERSION}-lts`;
  const map: Record<string, Source> = {
    "darwin-arm64": { kind: "binary", url: `${releaseBase}/clickhouse-macos-aarch64` },
    "darwin-x64": { kind: "binary", url: `${releaseBase}/clickhouse-macos` },
    "linux-arm64": {
      kind: "tarball",
      url: `${releaseBase}/clickhouse-common-static-${CH_VERSION}-arm64.tgz`,
      pathInTar: `clickhouse-common-static-${CH_VERSION}/usr/bin/clickhouse`,
    },
    "linux-x64": {
      kind: "tarball",
      url: `${releaseBase}/clickhouse-common-static-${CH_VERSION}-amd64.tgz`,
      pathInTar: `clickhouse-common-static-${CH_VERSION}/usr/bin/clickhouse`,
    },
  };
  const s = map[platform];
  if (!s) throw new Error(`No clickhouse build for ${platform}`);
  return s;
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
  label: "clickhouse",
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
    const out = join(paths.bin, "clickhouse");
    const src = downloadSource(platform);

    if (src.kind === "binary") {
      await downloadWithProgress(src.url, out, task, `downloading clickhouse ${CH_VERSION}`);
    } else {
      // Stage the .tgz under .langwatch/bin/, extract just the binary, then
      // delete the tarball — keeping disk hit minimal (~370MB tarball, ~580MB
      // extracted; we only keep the ~580MB binary).
      const tmp = join(paths.bin, `.clickhouse-${CH_VERSION}.tgz`);
      await downloadWithProgress(src.url, tmp, task, `downloading clickhouse ${CH_VERSION}`);

      task.output = "extracting";
      // Extract the single binary entry. tar.x with `filter` skips everything
      // else (man pages, completions, debug symbols). Sync to flush before
      // we rename + chmod — see redis.ts comment for the same race.
      tar.x({
        sync: true,
        file: tmp,
        cwd: paths.bin,
        filter: (path: string) => path === src.pathInTar,
      });
      // tar.x preserves the in-archive directory structure; relocate the
      // single extracted binary up to ~/.langwatch/bin/clickhouse and prune
      // the now-empty intermediate dirs.
      const extractedAt = join(paths.bin, src.pathInTar);
      if (!existsSync(extractedAt)) {
        throw new Error(
          `clickhouse extraction missed expected entry: ${src.pathInTar} not present after tar.x`,
        );
      }
      renameSync(extractedAt, out);
      // Prune the now-empty top-level dir from the archive
      // (`clickhouse-common-static-${VERSION}/`).
      const archiveRoot = src.pathInTar.split("/")[0]!;
      rmSync(join(paths.bin, archiveRoot), { recursive: true, force: true });
      rmSync(tmp, { force: true });
    }

    chmodSync(out, 0o755);
    const version = (await resolveVersion(out)) ?? "unknown";
    return { version, resolvedPath: out };
  },
};
