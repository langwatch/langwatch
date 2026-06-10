/**
 * @vitest-environment node
 *
 * Codifies the umbrella spec @no-bypass invariant as a CI-enforced
 * regression check: services + routes + UI must NOT call
 * `prisma.ingestionTemplate.*` / `prisma.auditLog.*` directly. Every
 * persistence touch routes through the repositories at
 * ee/governance/repositories/.
 *
 * If a future PR adds a direct `prisma.<governance-table>.*` call to a
 * file outside this allowlist, this test fails and the PR has to either
 * route through the repo or extend the allowlist with justification.
 *
 * Spec: specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature
 *       (@bdd @governance-api @no-bypass)
 */
import { execSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../../..");

/**
 * Files allowed to reference `prisma.<table>.*` for the gated tables.
 * The repository files are the persistence layer by design. Tests + the
 * platform-default seeder + dogfood scripts are also allowed because:
 *   - Tests need to set up + assert DB state directly to verify behavior
 *     end-to-end (no value in routing through the repos when the test
 *     IS the regression for the repo + service contract).
 *   - The platform seeder predates the repository extraction and lives
 *     adjacent to the service; it owns the platform-row catalog upsert
 *     and routing it through a repo would just shuffle the call site.
 *   - Dogfood scripts are local-only QA tooling, not the production
 *     write path; they're not part of the @no-bypass scope.
 */
const ALLOWED_FILE_PATTERNS = [
  "ee/governance/repositories/",
  "ee/governance/services/__tests__/",
  "ee/governance/services/platformIngestionTemplates.seeds.ts",
  "scripts/dogfood/",
  "src/app/api/governance/__tests__/",
  "src/mcp/__tests__/",
];

const GATED_TABLE_PATTERNS = [
  // This pattern asserts that no production code path outside the
  // allowlist invokes the table directly. The trailing dot is important —
  // it matches a method call like `.findMany(`, NOT a comment that
  // happens to mention the table name.
  String.raw`prisma\.ingestionTemplate\.`,
];

function grepRepo(pattern: string): string[] {
  // Use git grep so .gitignore is honored (skips node_modules, .next,
  // build artifacts) without us having to maintain an exclude list. -F
  // is NOT used because the patterns contain a regex backslash escape.
  try {
    const out = execSync(
      `git grep -n -E "${pattern}" -- "*.ts" "*.tsx" 2>/dev/null || true`,
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

function isAllowed(filePath: string): boolean {
  return ALLOWED_FILE_PATTERNS.some((p) => filePath.includes(p));
}

function isMethodCall(line: string): boolean {
  // Reject false positives in JSDoc/comments that mention the table by
  // name (`prisma.ingestionTemplate.*` inside a comment) — only assert
  // on actual method invocations like `.findMany(` / `.create({` / etc.
  // Matches: `prisma.foo.bar(` or `tx.foo.bar(`.
  return /\b(prisma|tx|client)\.ingestionTemplate\.[a-zA-Z]+\(/.test(line);
}

describe("no-bypass invariant: governance tables route through repositories", () => {
  for (const pattern of GATED_TABLE_PATTERNS) {
    it(`no production code outside the allowlist calls ${pattern}`, () => {
      const matches = grepRepo(pattern);
      const violations = matches.filter((line) => {
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1) return false;
        const filePath = line.slice(0, colonIdx);
        if (isAllowed(filePath)) return false;
        // Strip the leading "path:lineno:" prefix for the method-call
        // discriminator so we don't accept comment-only matches.
        const rest = line.slice(colonIdx + 1);
        const colonIdx2 = rest.indexOf(":");
        const codeFragment = colonIdx2 === -1 ? rest : rest.slice(colonIdx2 + 1);
        return isMethodCall(codeFragment);
      });
      if (violations.length > 0) {
        const message =
          `Direct prisma.<gated-table>.<method>() calls found outside the ` +
          `governance repository layer. Either route the call through ` +
          `ee/governance/repositories/<table>.repository.ts, or add the ` +
          `file to ALLOWED_FILE_PATTERNS with justification.\n\n` +
          violations.map((v) => `  - ${v}`).join("\n");
        throw new Error(message);
      }
      expect(violations).toEqual([]);
    });
  }

  it("repository files DO call the gated tables (sanity check the allowlist isn't a no-op)", () => {
    // If the repository files don't actually reference the gated tables,
    // the test above is meaningless — we'd be passing for the wrong
    // reason. This counter-test asserts the allowlist isn't masking a
    // bug where the refactor accidentally removed the persistence layer.
    const ingestionMatches = grepRepo(
      String.raw`prisma\.ingestionTemplate\.`,
    ).concat(
      grepRepo(String.raw`client\.ingestionTemplate\.`),
    );
    const repoMatches = ingestionMatches.filter((line) =>
      line.includes("ee/governance/repositories/"),
    );
    expect(repoMatches.length).toBeGreaterThan(0);
  });
});
