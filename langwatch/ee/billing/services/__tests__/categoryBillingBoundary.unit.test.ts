/**
 * ADR-033 invariant "Never feeds billing": no billing or plan-limit code path
 * may read category classification data. This static check walks the billing
 * (`ee/billing`) and plan-limit (`src/server/license-enforcement`) source trees
 * and asserts none of them import the block-classification module or reference
 * the reserved `blockcat` category attributes. A behavioural companion lives in
 * categoryBillingBoundary.integration.test.ts.
 *
 * Grep-based rather than a full import-graph walk (no such util exists in the
 * repo, ADR anchor permits it): direct imports are what a reviewer would add by
 * accident, and the classifier lives entirely under `block-classification`, so
 * any path into its outputs shows up as that path segment or the `blockcat`
 * attribute prefix.
 *
 * Spec: specs/ai-gateway/governance/cost-breakdown-dashboard.feature
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Repo-relative roots. __dirname is <repo>/langwatch/ee/billing/services/__tests__.
const REPO_LANGWATCH = join(__dirname, "..", "..", "..", "..");
const SCAN_ROOTS = [
  join(REPO_LANGWATCH, "ee", "billing"),
  join(REPO_LANGWATCH, "src", "server", "license-enforcement"),
];

// Anything that would tie billing to the category classifier.
const FORBIDDEN = ["block-classification", "blockcat", "blockClassifier"];

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    // The boundary tests themselves reference the forbidden tokens on purpose.
    if (/categoryBillingBoundary\./.test(entry)) continue;
    out.push(full);
  }
  return out;
}

describe("ADR-033 billing boundary: category data never reaches billing", () => {
  describe("given the billing and plan-limit source trees", () => {
    /** @scenario "Category totals never affect billing or plan limits" */
    it("contains no import or reference into the block-classification module", () => {
      const offenders: Array<{ file: string; token: string }> = [];
      for (const root of SCAN_ROOTS) {
        for (const file of collectSourceFiles(root)) {
          const src = readFileSync(file, "utf8");
          for (const token of FORBIDDEN) {
            if (src.includes(token)) {
              offenders.push({ file: file.replace(REPO_LANGWATCH, ""), token });
            }
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  });
});
