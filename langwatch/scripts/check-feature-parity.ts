#!/usr/bin/env tsx
/**
 * Feature-parity check: every `@integration` / `@unit` scenario in every
 * `.feature` file under `specs/**` must be bound to at least one test via a
 * `@scenario "<title>"` JSDoc annotation.
 *
 * Enforces the "Feature File Parity" rule from
 * dev/docs/TESTING_PHILOSOPHY.md. Without this check, feature files can drift
 * into documentation that nobody verifies.
 *
 * Polarity: enforce-all by default. Files listed in `LEGACY_UNBOUND` are
 * tolerated during migration — they still parse and are reported in the
 * `legacy` block, but unbound scenarios in those files do NOT fail CI.
 * Shrinking the deny-list toward zero is the work tracked by #3338.
 *
 * Usage:
 *   pnpm check:feature-parity              # exit 1 if any enforced unbound
 *   pnpm check:feature-parity --json       # machine-readable report
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, relative, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, "../..");
const SPECS_ROOT = resolve(REPO_ROOT, "specs");

/**
 * Test roots scanned for `@scenario` bindings. Every `.test.ts` /
 * `.test.tsx` file under these roots is parsed for annotations. A binding
 * matches by scenario title, so proximity of the feature file to the test
 * is not required — any test in these roots can bind any scenario.
 */
const DEFAULT_TEST_ROOTS: string[] = [
  "langwatch/src",
  "langwatch/ee",
  "mcp-server/src",
  "typescript-sdk/src",
  "python-sdk/src",
];

/**
 * Feature files whose unbound `@unit` / `@integration` scenarios are
 * tolerated (non-fatal) during migration. These files still parse; their
 * counts surface in the `legacy` block of `--json` output and in the
 * human-readable summary so shrinkage is visible.
 *
 * Direction: drive this list to empty. Adding a new file here should
 * require justification — prefer to bind, flag @unimplemented, or remove
 * the scenario.
 *
 * Invariants (enforced below):
 *   - Every path must resolve to an existing `.feature` file.
 *   - Every entry must actually contain at least one unbound `@unit` /
 *     `@integration` scenario. Fully-bound files must be removed — this
 *     prevents the list from rotting.
 */
const LEGACY_UNBOUND: string[] = [
  // Drive this list to empty by binding scenarios, flagging
  // `@unimplemented`, or removing scenarios from feature files.
  // See dev/docs/TESTING_PHILOSOPHY.md for the migration direction.
  //
  // nlp-go workflow engine (introduced by #3483) — scenarios document the
  // Go port of the NLP workflow engine. Tests live in services/aigateway
  // and langwatch_nlp; bindings have not been backfilled yet.
  "specs/nlp-go/code-block.feature",
  "specs/nlp-go/dataset-block.feature",
  "specs/nlp-go/engine.feature",
  "specs/nlp-go/feature-flag.feature",
  "specs/nlp-go/front-door.feature",
  "specs/nlp-go/http-block.feature",
  "specs/nlp-go/llm-block.feature",
  "specs/nlp-go/parallel-deployment.feature",
  "specs/nlp-go/proxy.feature",
  "specs/nlp-go/telemetry.feature",
  "specs/nlp-go/topic-clustering.feature",
  "specs/nlp-go/tracing-parity.feature",
  "specs/studio/dataset-creation-regression.feature",
];

const TEST_FILE_RE = /\.test\.tsx?$/;
const FEATURE_FILE_RE = /\.feature$/;
const SKIP_DIR = new Set(["node_modules", ".next", "dist", "build"]);

const BOUND_TAGS = new Set(["@unit", "@integration", "@e2e", "@regression"]);

/**
 * Scenarios tagged `@unimplemented` have no expected test and are filtered
 * out of bound/unbound counting — they represent tracked gaps, not binding
 * failures. See dev/docs/TESTING_PHILOSOPHY.md.
 */
const UNIMPLEMENTED_TAG = "@unimplemented";

interface Scenario {
  title: string;
  tags: string[];
  line: number;
}

interface BindingRef {
  file: string;
  line: number;
}

interface AnnotatedScenario extends Scenario {
  bindings: BindingRef[];
}

interface Report {
  feature: string;
  scenarios: AnnotatedScenario[];
  unbound: Scenario[];
}

interface LegacyReport {
  feature: string;
  bound: number;
  unbound: number;
  total: number;
  unboundTitles: string[];
}

interface UnknownAnnotation {
  title: string;
  ref: BindingRef;
}

interface CollectedBinding {
  title: string;
  ref: BindingRef;
}

function parseFeature(absPath: string): Scenario[] {
  const raw = readFileSync(absPath, "utf8");
  const lines = raw.split("\n");
  const scenarios: Scenario[] = [];
  // Tags preceding the `Feature:` line apply to every scenario in the file
  // per Gherkin semantics (feature-level tagging).
  let featureTags: string[] = [];
  let featureSeen = false;
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

    if (!featureSeen && trimmed.startsWith("Feature:")) {
      featureTags = pendingTags;
      pendingTags = [];
      featureSeen = true;
      continue;
    }

    const scenarioMatch = trimmed.match(/^Scenario(?:\s+Outline)?:\s*(.+)$/);
    if (scenarioMatch) {
      scenarios.push({
        title: scenarioMatch[1]!.trim(),
        tags: [...featureTags, ...pendingTags],
        line: i + 1,
      });
      pendingTags = [];
      continue;
    }

    if (!trimmed.startsWith("Given") && !trimmed.startsWith("When") &&
        !trimmed.startsWith("Then") && !trimmed.startsWith("And") &&
        !trimmed.startsWith("But") && !trimmed.startsWith("|")) {
      pendingTags = [];
    }
  }

  return scenarios;
}

function walkFiles(root: string, predicate: (name: string) => boolean): string[] {
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
      out.push(...walkFiles(full, predicate));
    } else if (predicate(entry)) {
      out.push(full);
    }
  }
  return out;
}

function discoverFeatureFiles(): string[] {
  const files = walkFiles(SPECS_ROOT, (n) => FEATURE_FILE_RE.test(n));
  return files.map((f) => relative(REPO_ROOT, f)).sort();
}

// Non-backtracking: find `@scenario <title>` tokens, then verify proximity
// to an `it(` / `test(` call with a linear forward scan (see
// `isFollowedByTestCall`). Doing it all in the regex invites ReDoS.
const ANNOTATION_RE =
  /@scenario[ \t]+(?:"([^"\n]+)"|'([^'\n]+)'|([^\n*]+?))[ \t]*(?:\*\/|$)/gm;

function isFollowedByTestCall(src: string, start: number): boolean {
  const len = src.length;
  let i = start;
  while (i < len) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      if (close === -1) return false;
      i = close + 2;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) return false;
      i = nl + 1;
      continue;
    }
    const rest = src.slice(i);
    const m = rest.match(/^(?:it|test)(?:\.[a-zA-Z]+)?\s*\(/);
    return m !== null;
  }
  return false;
}

function collectAllBindings(testRoots: string[]): CollectedBinding[] {
  const bindings: CollectedBinding[] = [];
  const files: string[] = [];
  for (const r of testRoots) {
    files.push(...walkFiles(resolve(REPO_ROOT, r), (n) => TEST_FILE_RE.test(n)));
  }

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
  featureRelPath: string,
  bindingsByTitle: Map<string, BindingRef[]>,
): Report {
  const absFeature = resolve(REPO_ROOT, featureRelPath);
  const allScenarios = parseFeature(absFeature);
  const scenarios = allScenarios.filter(
    (s) =>
      s.tags.some((t) => BOUND_TAGS.has(t)) &&
      !s.tags.includes(UNIMPLEMENTED_TAG)
  );

  const unbound: Scenario[] = [];
  const annotated: AnnotatedScenario[] = scenarios.map((s) => {
    const binds = bindingsByTitle.get(s.title) ?? [];
    if (binds.length === 0) unbound.push(s);
    return { ...s, bindings: binds };
  });

  return { feature: featureRelPath, scenarios: annotated, unbound };
}

function toLegacyReport(r: Report): LegacyReport {
  return {
    feature: r.feature,
    bound: r.scenarios.length - r.unbound.length,
    unbound: r.unbound.length,
    total: r.scenarios.length,
    unboundTitles: r.unbound.map((s) => s.title),
  };
}

function printEnforcedReport(r: Report): void {
  const total = r.scenarios.length;
  const boundCount = total - r.unbound.length;
  console.log(`\n▸ ${r.feature}`);
  console.log(`  ${boundCount}/${total} scenarios bound`);

  if (r.unbound.length === 0) {
    console.log(`  ✓ all bound`);
    return;
  }

  console.log(`\n  Unbound scenarios:`);
  for (const s of r.unbound) {
    const tags = s.tags.join(" ");
    console.log(`    ✗ [${tags}] ${s.title}`);
    console.log(`      ${r.feature}:${s.line}`);
    console.log(
      `      Add: /** @scenario ${s.title} */ directly above an it(...) test that exercises this behavior`
    );
  }
}

function printLegacySummary(reports: LegacyReport[]): void {
  if (reports.length === 0) return;
  const totalUnbound = reports.reduce((s, r) => s + r.unbound, 0);
  const totalBound = reports.reduce((s, r) => s + r.bound, 0);
  const totalScenarios = reports.reduce((s, r) => s + r.total, 0);
  console.log(`\nLegacy (tolerated — not failing CI):`);
  console.log(
    `  ${reports.length} file(s), ${totalBound}/${totalScenarios} bound, ${totalUnbound} unbound`
  );
  for (const r of reports) {
    console.log(`  · ${r.feature}  ${r.bound}/${r.total} bound, ${r.unbound} unbound`);
  }
  console.log(
    `\n  Shrink this list by binding scenarios, flagging @unimplemented, or removing stale scenarios. See dev/docs/TESTING_PHILOSOPHY.md.`
  );
}

function printUnknownAnnotations(unknown: UnknownAnnotation[]): void {
  if (unknown.length === 0) return;
  console.log(
    `\nAnnotations referencing unknown scenarios (typo? renamed scenario? stale binding?):`
  );
  for (const a of unknown) {
    console.log(`  ✗ @scenario ${a.title}`);
    console.log(`    ${a.ref.file}:${a.ref.line}`);
  }
}

function validateLegacyList(allFeatures: string[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of LEGACY_UNBOUND) {
    if (seen.has(entry)) {
      errors.push(`LEGACY_UNBOUND contains duplicate entry: ${entry}`);
      continue;
    }
    seen.add(entry);
    if (!allFeatures.includes(entry)) {
      const abs = resolve(REPO_ROOT, entry);
      if (!existsSync(abs)) {
        errors.push(
          `LEGACY_UNBOUND entry does not resolve to an existing .feature file: ${entry}`
        );
      } else {
        errors.push(
          `LEGACY_UNBOUND entry is not discovered under specs/: ${entry}`
        );
      }
    }
  }
  return errors;
}

function main(): void {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");

  const allFeatures = discoverFeatureFiles();
  const listErrors = validateLegacyList(allFeatures);

  const bindings = collectAllBindings(DEFAULT_TEST_ROOTS);
  const bindingsByTitle = indexByTitle(bindings);

  const allKnownTitles = new Set<string>();
  for (const f of allFeatures) {
    for (const s of parseFeature(resolve(REPO_ROOT, f))) {
      allKnownTitles.add(s.title);
    }
  }

  const unknownAnnotations: UnknownAnnotation[] = bindings
    .filter((b) => !allKnownTitles.has(b.title))
    .map((b) => ({ title: b.title, ref: b.ref }));

  const legacySet = new Set(LEGACY_UNBOUND);
  const enforced: Report[] = [];
  const legacy: LegacyReport[] = [];

  for (const f of allFeatures) {
    const report = buildReport(f, bindingsByTitle);
    if (legacySet.has(f)) {
      legacy.push(toLegacyReport(report));
    } else {
      enforced.push(report);
    }
  }

  // Legacy-list hygiene: every entry must still have at least one unbound
  // scenario. If a file is fully bound, it must be removed from the list.
  const staleLegacy = legacy.filter((r) => r.unbound === 0);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          enforced,
          legacy,
          unknownAnnotations,
          listErrors,
          staleLegacy: staleLegacy.map((r) => r.feature),
        },
        null,
        2
      )
    );
  } else {
    console.log("Feature-file parity check");
    console.log("=========================");
    console.log(
      `Enforced: ${enforced.length} file(s) · Legacy: ${legacy.length} file(s)`
    );

    for (const r of enforced) printEnforcedReport(r);
    printLegacySummary(legacy);
    printUnknownAnnotations(unknownAnnotations);
  }

  const enforcedUnbound = enforced.reduce((s, r) => s + r.unbound.length, 0);
  const hasFatal =
    enforcedUnbound > 0 ||
    unknownAnnotations.length > 0 ||
    listErrors.length > 0 ||
    staleLegacy.length > 0;

  if (hasFatal) {
    if (!asJson) {
      const parts: string[] = [];
      if (enforcedUnbound > 0) {
        parts.push(`${enforcedUnbound} unbound scenario(s) in enforced files`);
      }
      if (unknownAnnotations.length > 0) {
        parts.push(`${unknownAnnotations.length} unknown annotation(s)`);
      }
      if (staleLegacy.length > 0) {
        parts.push(
          `${staleLegacy.length} fully-bound file(s) still in LEGACY_UNBOUND — remove them from the list: ${staleLegacy
            .map((r) => r.feature)
            .join(", ")}`
        );
      }
      for (const err of listErrors) console.error(`LEGACY_UNBOUND error: ${err}`);
      console.error(
        `FAIL: ${parts.join(
          ", "
        )}. See spec-binding convention in dev/docs/TESTING_PHILOSOPHY.md.`
      );
    }
    process.exit(1);
  }

  if (!asJson) {
    const enforcedTotal = enforced.reduce(
      (s, r) => s + r.scenarios.length,
      0
    );
    const legacyUnbound = legacy.reduce((s, r) => s + r.unbound, 0);
    console.log(
      `\nOK: ${enforcedTotal} enforced scenario(s) bound across ${enforced.length} file(s).`
    );
    if (legacy.length > 0) {
      console.log(
        `    ${legacyUnbound} unbound scenario(s) tolerated in ${legacy.length} legacy file(s).`
      );
    }
  }
}

main();
