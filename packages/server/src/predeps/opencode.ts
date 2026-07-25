import { execa } from "execa";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as tar from "tar";
import { downloadWithProgress } from "./_download.ts";
import type { Predep } from "./types.ts";

// The runtime each Langy conversation runs inside. Pinned to an exact release
// rather than tracking latest: this binary executes model-written shell with
// the user's own credentials in its environment, so every rebuild silently
// re-evaluating trust in an upstream release is not a trade worth making.
// Keep in lockstep with the OPENCODE_VERSION pin in Dockerfile.langyagent —
// the skills and AGENTS.md are written against one grammar, not two.
export const OPENCODE_VERSION = "1.17.11";

// darwin ships zips, linux ships tarballs. The `-baseline` variants target
// pre-AVX2 x64 hardware; we take the standard build, matching the container
// image. musl variants are for Alpine, which is not a `npx` host we support.
type Source =
  | { kind: "zip"; url: string }
  | { kind: "tarball"; url: string };

function downloadSource(platform: string): Source {
  const asset: Record<string, Source> = {
    "darwin-arm64": { kind: "zip", url: assetUrl("opencode-darwin-arm64.zip") },
    "darwin-x64": { kind: "zip", url: assetUrl("opencode-darwin-x64.zip") },
    "linux-arm64": { kind: "tarball", url: assetUrl("opencode-linux-arm64.tar.gz") },
    "linux-x64": { kind: "tarball", url: assetUrl("opencode-linux-x64.tar.gz") },
  };
  const src = asset[platform];
  if (!src) throw new Error(`No opencode build for ${platform}`);
  return src;
}

function assetUrl(file: string): string {
  return `https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/${file}`;
}

async function resolveVersion(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execa(bin, ["--version"], { reject: false });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * The Langy assistant's worker runtime.
 *
 * Skipped entirely when the assistant is turned off, because it is the only
 * part of the install that exists solely for it — everything else Langy needs
 * (the manager itself) already ships inside the mono-binary we download for
 * the gateway.
 */
export function makeOpencodePredep({ enabled }: { enabled: boolean }): Predep {
  return {
    id: "opencode",
    label: "langy assistant runtime",
    // Not required: an install whose opencode download fails still has a
    // working LangWatch, just without the assistant. Failing the whole
    // install over an optional feature would be the wrong trade.
    required: false,

    async detect(paths) {
      if (!enabled) {
        return { installed: true, version: "skipped", resolvedPath: "" };
      }
      const bundled = join(paths.bin, "opencode");
      if (existsSync(bundled)) {
        const v = await resolveVersion(bundled);
        return { installed: true, version: v ?? "unknown", resolvedPath: bundled };
      }
      return { installed: false, reason: "opencode not in ~/.langwatch/bin" };
    },

    async install({ platform, paths, task }) {
      mkdirSync(paths.bin, { recursive: true });
      const out = join(paths.bin, "opencode");
      const src = downloadSource(platform);
      const label = `downloading langy assistant runtime ${OPENCODE_VERSION}`;

      if (src.kind === "tarball") {
        const tmp = join(paths.bin, `.opencode-${OPENCODE_VERSION}.tgz`);
        await downloadWithProgress(src.url, tmp, task, label);
        task.output = "extracting";
        // The archive holds a single `opencode` binary at its root.
        tar.x({ sync: true, file: tmp, cwd: paths.bin, filter: (p: string) => p === "opencode" });
        rmSync(tmp, { force: true });
      } else {
        const tmp = join(paths.bin, `.opencode-${OPENCODE_VERSION}.zip`);
        await downloadWithProgress(src.url, tmp, task, label);
        task.output = "extracting";
        // Node ships no zip reader; `unzip` is present on macOS by default.
        // Extract to a staging dir so a multi-entry archive cannot scatter
        // files into bin/, then lift the one binary out.
        const stage = join(paths.bin, `.opencode-${OPENCODE_VERSION}-stage`);
        rmSync(stage, { recursive: true, force: true });
        mkdirSync(stage, { recursive: true });
        await execa("unzip", ["-q", "-o", tmp, "-d", stage]);
        const extracted = join(stage, "opencode");
        if (!existsSync(extracted)) {
          rmSync(stage, { recursive: true, force: true });
          rmSync(tmp, { force: true });
          throw new Error(
            `opencode archive did not contain an \`opencode\` binary at its root (${src.url})`,
          );
        }
        rmSync(out, { force: true });
        renameSync(extracted, out);
        rmSync(stage, { recursive: true, force: true });
        rmSync(tmp, { force: true });
      }

      if (!existsSync(out)) {
        throw new Error(`opencode extraction produced no binary at ${out}`);
      }
      chmodSync(out, 0o755);
      const version = (await resolveVersion(out)) ?? OPENCODE_VERSION;
      return { version, resolvedPath: out };
    },
  };
}
