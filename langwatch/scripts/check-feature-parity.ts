#!/usr/bin/env tsx
/**
 * Feature-parity check: every @integration and @unit scenario in the
 * watched feature files must be bound to at least one test via a
 * `@scenario "<title>"` JSDoc annotation.
 *
 * Enforces the "Feature File Parity" rule from
 * dev/docs/TESTING_PHILOSOPHY.md. Without this check, feature files
 * can drift into documentation that nobody verifies.
 *
 * Usage:
 *   pnpm check:feature-parity              # exit 1 if any unbound
 *   pnpm check:feature-parity --json       # machine-readable report
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, "../..");
const LANGWATCH_ROOT = resolve(__dirname, "..");

interface WatchedFeature {
  featurePath: string;
  /** Root directories (relative to repo root) whose .test.ts / .test.tsx files are scanned for @scenario annotations. */
  testRoots: string[];
}

// Feature files explicitly under parity enforcement. Add entries here as
// feature files become ready for binding. Opt-in keeps the check focused
// and incremental.
const WATCHED: WatchedFeature[] = [
  {
    featurePath: "specs/scenarios/scenario-input-mapping.feature",
    testRoots: [
      "langwatch/src/server/scenarios",
      "langwatch/src/components/suites",
      "langwatch/src/components/agents",
    ],
  },
];

const TEST_FILE_RE = /\.test\.tsx?$/;
const SKIP_DIR = new Set(["node_modules", ".next", "dist", "build"]);

const BOUND_TAGS = new Set(["@unit", "@integration", "@e2e", "@regression"]);

interface Scenario {
  title: string;
  tags: string[];
  line: number;
}

interface BindingRef {
  file: string;
  line: number;
}

interface Report {
  feature: string;
  scenarios: {
    title: string;
    tags: string[];
    line: number;
    bindings: BindingRef[];
  }[];
  unbound: Scenario[];
}

function parseFeature(absPath: string): Scenario[] {
  const raw = readFileSync(absPath, "utf8");
  const lines = raw.split("\n");
  const scenarios: Scenario[] = [];
  let pendingTags: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (trimmed.startsWith("#") || trimmed === "") continue;

    if (trimmed.startsWith("@")) {
      pendingTags = trimmed.split(/\s+/).filter((t) => t.startsWith("@"));
      continue;
    }

    const scenarioMatch = trimmed.match(/^Scenario(?:\s+Outline)?:\s*(.+)$/);
    if (scenarioMatch) {
      scenarios.push({
        title: scenarioMatch[1]!.trim(),
        tags: pendingTags,
        line: i + 1,
      });
      pendingTags = [];
      continue;
    }

    // Any other non-blank, non-comment line resets pending tags (e.g. Feature:, Background:)
    if (!trimmed.startsWith("Given") && !trimmed.startsWith("When") &&
        !trimmed.startsWith("Then") && !trimmed.startsWith("And") &&
        !trimmed.startsWith("But") && !trimmed.startsWith("|")) {
      pendingTags = [];
    }
  }

  return scenarios;
}

function walkTestFiles(root: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIR.has(entry) || entry.startsWith(".")) continue;
    const full = join(root, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      walkTestFiles(full, out);
    } else if (TEST_FILE_RE.test(entry)) {
      out.push(full);
    }
  }
}

function collectBindings(testRoots: string[]): Map<string, BindingRef[]> {
  const byTitle = new Map<string, BindingRef[]>();
  const files: string[] = [];
  for (const r of testRoots) walkTestFiles(resolve(REPO_ROOT, r), files);

  // Match `@scenario <title>` where <title> may be quoted or plain up to EOL
  // (stripping a trailing ` */` if the annotation sits inside a JSDoc block).
  // Plain form: text after `@scenario ` up to end of line, minus any trailing
  // ` */` or `*/`.
  const annotationRe = /@scenario[ \t]+(?:"([^"]+)"|'([^']+)'|([^\n]+?))[ \t]*$/gm;

  for (const file of files) {
    const src = readFileSync(file, "utf8");

    let m: RegExpExecArray | null;
    annotationRe.lastIndex = 0;
    while ((m = annotationRe.exec(src)) !== null) {
      const rawTitle = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      // Strip trailing JSDoc close or leading star/space remnants.
      const title = rawTitle.replace(/\*\/\s*$/, "").trim();
      if (!title) continue;
      const line = src.slice(0, m.index).split("\n").length;
      const ref: BindingRef = {
        file: relative(REPO_ROOT, file),
        line,
      };
      const existing = byTitle.get(title) ?? [];
      existing.push(ref);
      byTitle.set(title, existing);
    }
  }

  return byTitle;
}

function buildReport(watched: WatchedFeature): Report {
  const absFeature = resolve(REPO_ROOT, watched.featurePath);
  const allScenarios = parseFeature(absFeature);
  const scenarios = allScenarios.filter((s) =>
    s.tags.some((t) => BOUND_TAGS.has(t))
  );

  const bindings = collectBindings(watched.testRoots);

  const unbound: Scenario[] = [];
  const annotated = scenarios.map((s) => {
    const binds = bindings.get(s.title) ?? [];
    if (binds.length === 0) unbound.push(s);
    return { ...s, bindings: binds };
  });

  return {
    feature: watched.featurePath,
    scenarios: annotated,
    unbound,
  };
}

function printHuman(report: Report): void {
  const total = report.scenarios.length;
  const boundCount = total - report.unbound.length;
  console.log(`\n▸ ${report.feature}`);
  console.log(`  ${boundCount}/${total} scenarios bound`);

  if (report.unbound.length === 0) {
    console.log(`  ✓ all bound\n`);
    return;
  }

  console.log(`\n  Unbound scenarios:`);
  for (const s of report.unbound) {
    const tags = s.tags.join(" ");
    console.log(`    ✗ [${tags}] ${s.title}`);
    console.log(`      ${report.feature}:${s.line}`);
    console.log(
      `      Add: /** @scenario ${s.title} */ above an it(...) test that exercises this behavior`
    );
  }
  console.log("");
}

function main(): void {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");

  const reports = WATCHED.map(buildReport);

  if (asJson) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    console.log("Feature-file parity check");
    console.log("=========================");
    for (const r of reports) printHuman(r);
  }

  const anyUnbound = reports.some((r) => r.unbound.length > 0);
  if (anyUnbound) {
    if (!asJson) {
      console.error(
        `FAIL: ${reports.reduce(
          (sum, r) => sum + r.unbound.length,
          0
        )} scenario(s) unbound. See spec-binding convention in dev/docs/TESTING_PHILOSOPHY.md.`
      );
    }
    process.exit(1);
  }

  if (!asJson) console.log("OK: all watched scenarios bound.");
}

main();
