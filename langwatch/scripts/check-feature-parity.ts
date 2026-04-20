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
      const lineTags = trimmed.split(/\s+/).filter((t) => t.startsWith("@"));
      pendingTags = pendingTags.concat(lineTags);
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

// A simple, non-backtracking regex that only finds `@scenario <title>` tokens.
// Proximity to an `it(...)` / `test(...)` call is verified with a linear
// forward scan in `isFollowedByTestCall` below — doing it in the regex is
// tempting but invites ReDoS via nested quantifiers around repeated JSDoc
// blocks.
const ANNOTATION_RE =
  /@scenario[ \t]+(?:"([^"\n]+)"|'([^'\n]+)'|([^\n*]+?))[ \t]*(?:\*\/|$)/gm;

/**
 * Starting at `start` (inclusive), scan forward and return true iff the next
 * non-trivial token is an `it(` / `test(` / `it.only(` / `test.skip(` call.
 *
 * "Trivial" here means: whitespace (including newlines) and complete JSDoc
 * blocks `/* ... *\/`. Anything else — code, line comments, import statements
 * — means the annotation isn't acting as a binding and we skip it.
 */
function isFollowedByTestCall(src: string, start: number): boolean {
  const len = src.length;
  let i = start;
  while (i < len) {
    const ch = src[i];
    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    // Sibling JSDoc / block comment
    if (ch === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      if (close === -1) return false;
      i = close + 2;
      continue;
    }
    // Line comment (uncommon here, but tolerate)
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) return false;
      i = nl + 1;
      continue;
    }
    // Anything else: must be the start of an it/test call identifier.
    // Match `it` or `test`, optionally followed by `.something`, then `(`.
    const rest = src.slice(i);
    const m = rest.match(/^(?:it|test)(?:\.[a-zA-Z]+)?\s*\(/);
    return m !== null;
  }
  return false;
}

function collectAllBindings(testRoots: string[]): CollectedBinding[] {
  const bindings: CollectedBinding[] = [];
  const files: string[] = [];
  for (const r of testRoots) files.push(...walkTestFiles(resolve(REPO_ROOT, r)));

  for (const file of files) {
    const src = readFileSync(file, "utf8");

    let m: RegExpExecArray | null;
    ANNOTATION_RE.lastIndex = 0;
    while ((m = ANNOTATION_RE.exec(src)) !== null) {
      const title = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      if (!title) continue;
      if (!isFollowedByTestCall(src, m.index + m[0].length)) continue;
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

function buildReport(
  watched: WatchedFeature,
  allKnownTitles: Set<string>,
): Report {
  const absFeature = resolve(REPO_ROOT, watched.featurePath);
  const allScenarios = parseFeature(absFeature);
  const scenarios = allScenarios.filter((s) =>
    s.tags.some((t) => BOUND_TAGS.has(t))
  );

  const collected = collectAllBindings(watched.testRoots);
  const bindings = indexByTitle(collected);

  const unbound: Scenario[] = [];
  const annotated = scenarios.map((s) => {
    const binds = bindings.get(s.title) ?? [];
    if (binds.length === 0) unbound.push(s);
    return { ...s, bindings: binds };
  });

  const unknownAnnotations = collected
    .filter((b) => !allKnownTitles.has(b.title))
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

  const allKnownTitles = new Set<string>();
  for (const w of WATCHED) {
    for (const s of parseFeature(resolve(REPO_ROOT, w.featurePath))) {
      allKnownTitles.add(s.title);
    }
  }

  const reports = WATCHED.map((w) => buildReport(w, allKnownTitles));

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
