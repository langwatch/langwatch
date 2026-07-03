/**
 * ADR-033 invariant "Never feeds billing": no billing, licensing, plan-limit,
 * or budget-enforcement code path may read category classification data. This
 * static check walks those source trees and asserts none of them import the
 * block-classification module or reference the reserved `blockcat` category
 * attributes. A behavioural companion lives in
 * categoryBillingBoundary.integration.test.ts.
 *
 * `ee/governance` is scanned too — its budget/anomaly enforcement lives there —
 * but the two DASHBOARD read paths (personalUsage, activity-monitor) plus their
 * routers/tests are allowlisted: they are the analytics display surface the
 * ADR explicitly permits, and allowlisting by exact path keeps any NEW
 * governance file that touches blockcat failing this test by default.
 *
 * Grep-based rather than a full import-graph walk (no such util exists in the
 * repo, ADR anchor permits it): direct imports are what a reviewer would add by
 * accident, and the classifier lives entirely under `block-classification`, so
 * any path into its outputs shows up as that path segment or the `blockcat`
 * attribute prefix.
 *
 * Spec: specs/ai-gateway/governance/cost-breakdown-dashboard.feature
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Repo-relative roots. __dirname is <repo>/langwatch/ee/billing/services/__tests__.
const REPO_LANGWATCH = join(__dirname, "..", "..", "..", "..");
const SCAN_ROOTS = [
  join(REPO_LANGWATCH, "ee", "billing"),
  join(REPO_LANGWATCH, "ee", "licensing"),
  join(REPO_LANGWATCH, "ee", "saas"),
  join(REPO_LANGWATCH, "ee", "governance"),
  join(REPO_LANGWATCH, "src", "server", "license-enforcement"),
];

// The permitted analytics display surface (ADR-033 Decision 9) — exact paths.
const ALLOWLISTED_READ_PATHS = [
  join("ee", "governance", "services", "personalUsage.service.ts"),
  join(
    "ee",
    "governance",
    "services",
    "activity-monitor",
    "activityMonitor.service.ts",
  ),
  join("ee", "governance", "routers", "activityMonitor.ts"),
].map((p) => sep + p);

// Anything that would tie billing to the category classifier.
const FORBIDDEN = ["block-classification", "blockcat", "blockClassifier"];

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  // A renamed/removed scan root must not throw ENOENT and abort the boundary
  // suite — skip absent roots (the allowlist assertion still guards coverage).
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    // The boundary tests themselves reference the forbidden tokens on purpose,
    // and governance __tests__ fixtures exercise the dashboard read paths.
    if (/categoryBillingBoundary\./.test(entry)) continue;
    if (full.includes(`${sep}__tests__${sep}`)) continue;
    if (ALLOWLISTED_READ_PATHS.some((p) => full.endsWith(p))) continue;
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
