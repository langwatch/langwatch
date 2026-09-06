import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";
import { walkFiles } from "./files";
import { isOverengineeringSource, overengineeringFindings } from "./overengineering-policy.mjs";

/**
 * The three over-abstraction policies — `layer-class`,
 * `conditional-type-depth` and `overload-by-literal` — are reported by the
 * oxlint rules of those names, so a reader sees them while typing. What
 * stays here is the baseline: the shrink-only site list, and the check that
 * an entry still names a live finding.
 */

const BASELINE_FILE = "overengineering-baseline.json";

/**
 * The sites that already existed when these three policies landed. The list
 * may shrink and may never grow: a new one fails the lint run, and an entry
 * whose site is gone fails too, so the file cannot quietly stop meaning
 * anything. Keyed by `policy|file` rather than by line.
 */
function baselineKeys(root: string): Set<string> {
  const path = join(root, "packages/architecture-lint/src", BASELINE_FILE);
  if (!existsSync(path)) return new Set();

  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const sites =
    typeof parsed === "object" && parsed !== null && "sites" in parsed
      ? (parsed as { sites?: unknown }).sites
      : undefined;

  return new Set(
    Array.isArray(sites) ? sites.filter((s): s is string => typeof s === "string") : [],
  );
}

export function collectOverengineering(
  root: string,
  packages: readonly ClassifiedPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  // A package root can contain another package — `packages/enterprise` holds
  // every enterprise feature — so the same file is reachable twice. Lint each
  // one once, keyed by the path the walk found.
  const linted = new Set<string>();
  for (const pkg of packages) {
    if (pkg.kind === "tooling" || pkg.kind === "dev-runtime") continue;

    for (const file of walkFiles(pkg.root, isOverengineeringSource)) {
      if (linted.has(file)) continue;

      linted.add(file);
      for (const finding of overengineeringFindings({
        path: file,
        source: readFileSync(file, "utf8"),
      })) {
        violations.push({ ...finding, file });
      }
    }
  }

  return violations;
}

function siteKey(root: string, violation: ArchitectureViolation): string {
  const file = relative(root, violation.file).split("\\").join("/");

  return `${violation.policy}|${file}`;
}

/** Every site, as the baseline file spells them. */
export function formatOverengineeringBaseline(
  root: string,
  packages: readonly ClassifiedPackage[],
): string {
  const sites = [...new Set(collectOverengineering(root, packages).map((v) => siteKey(root, v)))];

  return `${JSON.stringify({ version: 0, sites: sites.sort() }, null, 2)}\n`;
}

/**
 * The baseline's own health: an entry whose site no longer fires. The live
 * findings themselves belong to the oxlint rules, which read the same
 * baseline file and stay quiet for a listed site.
 */
export function lintOverengineeringBaseline(
  root: string,
  packages: readonly ClassifiedPackage[],
): ArchitectureViolation[] {
  const baseline = baselineKeys(root);
  if (baseline.size === 0) return [];

  const seen = new Set(collectOverengineering(root, packages).map((v) => siteKey(root, v)));

  return [...baseline]
    .filter((key) => !seen.has(key))
    .sort()
    .map((stale) => {
      const [policy, file] = stale.split("|");

      return {
        policy: "overengineering-baseline",
        file: join(root, file ?? ""),
        message: `${policy} no longer fires here, so the baseline entry is stale.`,
        allowed: `Delete "${stale}" from packages/architecture-lint/src/${BASELINE_FILE}. The list may only shrink.`,
      };
    });
}
