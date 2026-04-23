import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for langwatch/langwatch#3413.
 *
 * Why: when `@ai-sdk/provider` resolves to more than one major version in
 * `node_modules`, `ai` v6 silently falls back to V2 compatibility mode for
 * models constructed through `@ai-sdk/openai-compatible`. That path powers
 * scenario runs (`model.factory.ts`, `prompt-config.adapter.ts`,
 * `scenario-child-process.ts`), and the compat-mode warning was accompanied
 * by HTTP 500s from the code-agent surface.
 *
 * The only observable, deterministic invariant from pure code inspection is
 * the lockfile: exactly one `@ai-sdk/provider@x.y.z` entry, with major 3.
 * Everything else (the runtime warning, the HTTP 500) depends on network and
 * scenario harness state — not suitable for a unit test.
 */

const LOCKFILE_PATH = join(__dirname, "../../../../..", "pnpm-lock.yaml");
const PROVIDER_VERSION_RE = /^\s{2}'?@ai-sdk\/provider@(\d+\.\d+\.\d+)'?:/gm;

function uniqueProviderVersions(lockfile: string): string[] {
  const versions = new Set<string>();
  for (const match of lockfile.matchAll(PROVIDER_VERSION_RE)) {
    versions.add(match[1]!);
  }
  return [...versions].sort();
}

describe("@ai-sdk/provider version alignment (regression for #3413)", () => {
  const lockfile = readFileSync(LOCKFILE_PATH, "utf8");
  const versions = uniqueProviderVersions(lockfile);

  it("resolves to exactly one @ai-sdk/provider version", () => {
    expect(
      versions,
      `Expected a single @ai-sdk/provider version in pnpm-lock.yaml. ` +
        `Found: ${versions.join(", ")}. ` +
        `Multiple majors force 'ai' v6 into V2 compatibility mode — see #3413.`,
    ).toHaveLength(1);
  });

  it("pins @ai-sdk/provider to major 3.x", () => {
    expect(versions).toHaveLength(1);
    const major = Number(versions[0]!.split(".")[0]);
    expect(
      major,
      `@ai-sdk/provider must be major 3.x (the V3 LanguageModel spec ` +
        `expected by 'ai' v6). Found: ${versions[0]}.`,
    ).toBe(3);
  });
});
