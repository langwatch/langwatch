// ADR-094 Decision 10 / Invariants "Never authorizes": no permission
// decision reads link data. Decision 6 makes that structural — the
// access-control code must not depend on the identity-link package, enforced
// here so a future "who is this?" permission check gets a red build, not a
// code-review comment.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const APP_ROOT = join(__dirname, "../../../..");

/**
 * The authorization surface: everything that decides or gates access. New
 * authz code belongs under one of these paths; if it moves, move the entry
 * with it rather than deleting it.
 */
const AUTHZ_PATHS = [
  "src/server/api/rbac.ts",
  "src/server/api/trpc.ts",
  "src/server/auth.ts",
  "src/server/role-bindings",
  "src/server/api-key",
  "src/server/better-auth",
];

const BANNED_IMPORT = "@langwatch/identity-links";
const BANNED_RELATIVE = "packages/identity-links";

const sourceFilesUnder = (path: string): string[] => {
  const stats = statSync(path);
  if (stats.isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(child);
    return /\.(ts|tsx|mts|cts)$/.test(entry.name) ? [child] : [];
  });
};

describe("authz never imports the identity-link package (ADR-094 Decisions 6 and 10)", () => {
  it("every authz path exists (the surface list cannot rot silently)", () => {
    for (const path of AUTHZ_PATHS) {
      expect(() => statSync(join(APP_ROOT, path)), path).not.toThrow();
    }
  });

  it.each(AUTHZ_PATHS)("%s imports nothing from it", (authzPath) => {
    for (const file of sourceFilesUnder(join(APP_ROOT, authzPath))) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain(BANNED_IMPORT);
      expect(source, file).not.toContain(BANNED_RELATIVE);
    }
  });
});
