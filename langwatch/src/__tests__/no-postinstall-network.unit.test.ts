/**
 * Regression test for issue #3903 AC 5: no new postinstall network calls.
 *
 * pnpm install must not trigger automatic binary downloads. Any `postinstall`,
 * `prepare`, or other install-lifecycle script that shells out to curl/wget/
 * fetch/download or hits an HTTP(S) URL introduces a network dependency that
 * blocks fresh-clone setups in air-gapped or restricted environments, and
 * degrades DX by making `pnpm install` non-deterministic.
 *
 * The current postinstall ("make -C .. setup-hooks 2>/dev/null || true") is
 * intentionally local and SHOULD pass all three assertions below.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Resolve package.json relative to this test file's location:
// src/__tests__/ -> ../../ -> langwatch/package.json
const PACKAGE_JSON_PATH = path.join(__dirname, "../../package.json");

interface PackageJson {
  scripts?: Record<string, string>;
}

const pkg: PackageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8"));

/**
 * Patterns that indicate a script is downloading from the network.
 * Any match in a lifecycle script means the constraint is violated.
 */
const FORBIDDEN_PATTERNS = [
  /curl/i,
  /wget/i,
  /\bfetch\b/i,
  /download/i,
  /https?:\/\//i,
] as const;

/**
 * Returns true when the given script string contains any forbidden pattern.
 */
function hasNetworkCall(script: string): boolean {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(script));
}

describe("langwatch/package.json", () => {
  describe("when install-lifecycle scripts are inspected", () => {
    it("postinstall does not download from the network", () => {
      const script = pkg.scripts?.postinstall;
      if (script === undefined) return; // no postinstall — constraint satisfied
      expect(
        hasNetworkCall(script),
        `scripts.postinstall must not contain network calls (curl/wget/fetch/download/http). Got: "${script}"`,
      ).toBe(false);
    });

    it("prepare does not download from the network", () => {
      const script = pkg.scripts?.prepare;
      if (script === undefined) return; // no prepare — constraint satisfied
      expect(
        hasNetworkCall(script),
        `scripts.prepare must not contain network calls (curl/wget/fetch/download/http). Got: "${script}"`,
      ).toBe(false);
    });

    it("no install-lifecycle script downloads a binary from the network", () => {
      const scripts = pkg.scripts ?? {};
      const installKeys = Object.keys(scripts).filter((k) =>
        k.toLowerCase().includes("install"),
      );
      for (const key of installKeys) {
        const script = scripts[key]!;
        expect(
          hasNetworkCall(script),
          `scripts["${key}"] must not contain network calls (curl/wget/fetch/download/http). Got: "${script}"`,
        ).toBe(false);
      }
    });
  });
});
