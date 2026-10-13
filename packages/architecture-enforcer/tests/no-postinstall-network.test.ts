/**
 * Regression test for issue #3903 AC 5: no new postinstall network calls —
 * a lifecycle script that shells to curl/wget/fetch or hits an HTTP(S) URL
 * blocks air-gapped setups. Scans tracked package.json via `git ls-files`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const manifestPaths: string[] = execFileSync(
  "git",
  ["ls-files", "-z", "--", "package.json", "*/package.json", "**/package.json"],
  { cwd: REPO_ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
)
  .split("\0")
  .filter(
    (path) =>
      path.length > 0 && !path.includes("node_modules/") && existsSync(join(REPO_ROOT, path)),
  );

interface PackageJson {
  scripts?: Record<string, string>;
}

const manifests: { path: string; pkg: PackageJson }[] = manifestPaths.map((path) => ({
  path,
  pkg: JSON.parse(readFileSync(join(REPO_ROOT, path), "utf-8")) as PackageJson,
}));

/** Every lifecycle script of `name` across the workspace, with the manifest that declared it. */
function lifecycleScripts(name: string): { path: string; script: string }[] {
  return manifests.flatMap(({ path, pkg }) => {
    const script = pkg.scripts?.[name];
    return script === undefined ? [] : [{ path, script }];
  });
}

/**
 * Patterns that indicate a script is downloading from the network.
 * Any match in a lifecycle script means the constraint is violated.
 */
const FORBIDDEN_PATTERNS = [/curl/i, /wget/i, /\bfetch\b/i, /download/i, /https?:\/\//i] as const;

/**
 * Returns true when the given script string contains any forbidden pattern.
 */
function hasNetworkCall(script: string): boolean {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(script));
}

describe("every tracked package.json", () => {
  describe("when install-lifecycle scripts are inspected", () => {
    it("scans at least the root manifest and the two application manifests", () => {
      expect(manifestPaths).toContain("package.json");
      expect(manifestPaths).toContain("apps/api/package.json");
      expect(manifestPaths).toContain("apps/worker/package.json");
    });

    it("postinstall does not download from the network", () => {
      const offenders = lifecycleScripts("postinstall").filter(({ script }) =>
        hasNetworkCall(script),
      );
      expect(
        offenders,
        "postinstall must not contain network calls (curl/wget/fetch/download/http)",
      ).toEqual([]);
    });

    it("prepare does not download from the network", () => {
      const offenders = lifecycleScripts("prepare").filter(({ script }) => hasNetworkCall(script));
      expect(
        offenders,
        "prepare must not contain network calls (curl/wget/fetch/download/http)",
      ).toEqual([]);
    });

    /** @scenario No postinstall script reaches the network to download goose */
    it("no install-lifecycle script downloads a binary from the network", () => {
      const offenders: string[] = [];
      for (const { path, pkg } of manifests) {
        for (const [key, script] of Object.entries(pkg.scripts ?? {})) {
          if (!key.toLowerCase().includes("install")) continue;
          if (hasNetworkCall(script)) {
            offenders.push(`${path} scripts["${key}"]: ${script}`);
          }
        }
      }
      expect(
        offenders,
        "install-lifecycle scripts must not contain network calls (curl/wget/fetch/download/http)",
      ).toEqual([]);
    });
  });
});
