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
  /** Annotations that reference a title not present in any watched feature file. */
  unknownAnnotations: { title: string; ref: BindingRef }[];
}

interface CollectedBinding {
  title: string;
  ref: BindingRef;
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

function walkTestFiles(root: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return out;
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
      out.push(...walkTestFiles(full));
    } else if (TEST_FILE_RE.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// Match an @scenario annotation inside a JSDoc comment that is eventually
// followed by an it(...) or test(...) call, with nothing between the
// annotation's closing `*/` and the call except whitespace and additional
// JSDoc blocks (so multiple stacked annotations all bind the same test).
//
// The trailing lookahead enforces proximity — a stray @scenario in a helper,
// import docblock, or unrelated JSDoc cannot pose as a binding. The lookahead
// also keeps lastIndex immediately after the annotation so the next iteration
// can pick up a sibling annotation on the following line.
const BINDING_RE =
  /@scenario[ \t]+(?:"([^"\n]+)"|'([^'\n]+)'|([^\n*]+?))[ \t]*(?:\*\/|(?:\n[ \t]*\*[^\n]*)*[ \t]*\n[ \t]*\*\/)(?=[ \t]*\n(?:[ \t]*\/\*[\s\S]*?\*\/[ \t]*\n)*[ \t]*(?:it|test)(?:\.[a-zA-Z]+)?\s*\()/g;

function collectAllBindings(testRoots: string[]): CollectedBinding[] {
  const bindings: CollectedBinding[] = [];
  const files: string[] = [];
  for (const r of testRoots) files.push(...walkTestFiles(resolve(REPO_ROOT, r)));

  for (const file of files) {
    const src = readFileSync(file, "utf8");

    let m: RegExpExecArray | null;
    BINDING_RE.lastIndex = 0;
    while ((m = BINDING_RE.exec(src)) !== null) {
      const title = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      if (!title) continue;
      const line = src.slice(0, m.index).split("\n").length;
      bindings.push({
        title,
        ref: { file: relative(REPO_ROOT, file), line },
      });
    }
  }

  return bindings;
}

function indexByTitle(bindings: CollectedBinding[]): Map<string, BindingRef[]> {
  const byTitle = new Map<string, BindingRef[]>();
  for (const b of bindings) {
    const existing = byTitle.get(b.title) ?? [];
    existing.push(b.ref);
    byTitle.set(b.title, existing);
  }
  return byTitle;
}

function buildReport(watched: WatchedFeature): Report {
  const absFeature = resolve(REPO_ROOT, watched.featurePath);
  const allScenarios = parseFeature(absFeature);
  const scenarios = allScenarios.filter((s) =>
    s.tags.some((t) => BOUND_TAGS.has(t))
  );

  const knownTitles = new Set(allScenarios.map((s) => s.title));
  const collected = collectAllBindings(watched.testRoots);
  const bindings = indexByTitle(collected);

  const unbound: Scenario[] = [];
  const annotated = scenarios.map((s) => {
    const binds = bindings.get(s.title) ?? [];
    if (binds.length === 0) unbound.push(s);
    return { ...s, bindings: binds };
  });

  const unknownAnnotations = collected
    .filter((b) => !knownTitles.has(b.title))
    .map((b) => ({ title: b.title, ref: b.ref }));

  return {
    feature: watched.featurePath,
    scenarios: annotated,
    unbound,
    unknownAnnotations,
  };
}

function printHuman(report: Report): void {
  const total = report.scenarios.length;
  const boundCount = total - report.unbound.length;
  console.log(`\n▸ ${report.feature}`);
  console.log(`  ${boundCount}/${total} scenarios bound`);

  if (report.unbound.length === 0 && report.unknownAnnotations.length === 0) {
    console.log(`  ✓ all bound\n`);
    return;
  }

  if (report.unbound.length > 0) {
    console.log(`\n  Unbound scenarios:`);
    for (const s of report.unbound) {
      const tags = s.tags.join(" ");
      console.log(`    ✗ [${tags}] ${s.title}`);
      console.log(`      ${report.feature}:${s.line}`);
      console.log(
        `      Add: /** @scenario ${s.title} */ directly above an it(...) test that exercises this behavior`
      );
    }
  }

  if (report.unknownAnnotations.length > 0) {
    console.log(
      `\n  Annotations referencing unknown scenarios (typo? renamed scenario? stale binding?):`
    );
    for (const a of report.unknownAnnotations) {
      console.log(`    ✗ @scenario ${a.title}`);
      console.log(`      ${a.ref.file}:${a.ref.line}`);
    }
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

  const unboundCount = reports.reduce((sum, r) => sum + r.unbound.length, 0);
  const unknownCount = reports.reduce(
    (sum, r) => sum + r.unknownAnnotations.length,
    0
  );

  if (unboundCount > 0 || unknownCount > 0) {
    if (!asJson) {
      const parts: string[] = [];
      if (unboundCount > 0) parts.push(`${unboundCount} unbound scenario(s)`);
      if (unknownCount > 0) parts.push(`${unknownCount} unknown annotation(s)`);
      console.error(
        `FAIL: ${parts.join(", ")}. See spec-binding convention in dev/docs/TESTING_PHILOSOPHY.md.`
      );
    }
    process.exit(1);
  }

  if (!asJson) console.log("OK: all watched scenarios bound.");
}

main();
