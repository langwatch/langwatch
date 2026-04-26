import { execa } from "execa";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadWithProgress } from "./_download.ts";
import type { Predep } from "./types.ts";

// The Go AI Gateway monobinary is built per-platform in CI and uploaded to a
// GitHub release named v$VERSION. The npm package version is in lockstep with
// the langwatch release tag — see .github/workflows/npx-server-publish.yml.
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

// When running from a langwatch checkout (dev mode), `cmd/service` exists
// alongside packages/server. We can `go build` it ourselves instead of
// relying on a GH release artifact that may not exist for the current dev
// tree (chicken-and-egg before v3.1.0 publishes the gateway monobinary).
function findRepoRoot(): string | null {
  let here: string;
  try {
    here = fileURLToPath(import.meta.url);
  } catch {
    here = __filename;
  }
  let dir = dirname(here);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "go.mod")) && existsSync(join(dir, "cmd", "service"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function buildFromCheckout(repoRoot: string, outDir: string, task: { output?: string }): Promise<void> {
  task.output = "building from local checkout (cmd/service)";
  // `go build ./cmd/service` produces a multi-service entrypoint; the gateway
  // is invoked as `service aigateway`. We compile to ~/.langwatch/bin/.service
  // and shim a wrapper script so callers can run `aigateway --version` etc.
  const realBin = join(outDir, ".service");
  await execa("go", ["build", "-o", realBin, "./cmd/service"], { cwd: repoRoot, stdio: "pipe" });
  const wrapper = join(outDir, "aigateway");
  writeFileSync(wrapper, `#!/bin/sh\nexec "${realBin}" aigateway "$@"\n`, { mode: 0o755 });
  chmodSync(wrapper, 0o755);
}

export function makeAigatewayPredep(version: string): Predep {
  return {
    id: "aigateway",
    label: "langwatch ai-gateway",
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
      const out = join(paths.bin, "aigateway");

      const url = downloadUrl(version, platform);
      try {
        await downloadWithProgress(url, out, task, `downloading langwatch ai-gateway ${version}`);
        chmodSync(out, 0o755);
        const v = (await resolveVersion(out)) ?? version;
        return { version: v, resolvedPath: out };
      } catch (err) {
        // GH release HTTP miss falls through to the local-build path below.
        // Other errors (disk full, etc.) we'd want to surface, but in
        // practice the only HTTP error we care about is 404 on a not-yet-
        // published release artifact — local-build is the right fallback.
        if (!(err instanceof Error) || !/HTTP 404/.test(err.message)) throw err;
      }

      // GH release artifact is missing — fall back to a local Go build if we
      // can find a checkout (this is the chicken-and-egg path: pre-v3.1.0
      // npx publish doesn't have the artifact yet, but every CI run + every
      // dogfood run happens from a checkout that has cmd/service).
      const repoRoot = findRepoRoot();
      if (repoRoot) {
        await buildFromCheckout(repoRoot, paths.bin, task);
        const v = (await resolveVersion(out)) ?? `${version}+local-build`;
        return { version: v, resolvedPath: out };
      }

      throw new Error(
        `aigateway download failed for v${version} (${url}). No local checkout found to build from. The v${version} release must publish aigateway-${platform.replace("x64", "amd64")} for npx-only installs to work.`,
      );
    },
  };
}
