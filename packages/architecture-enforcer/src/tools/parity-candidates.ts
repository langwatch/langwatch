#!/usr/bin/env -S node --experimental-transform-types
/**
 * Ranks, for every unbound scenario `check-feature-parity` reports, the tests most
 * likely to prove it, so a binding lane verifies instead of searching. Scores the
 * scenario steps' distinctive terms against test bodies and assertions, not titles.
 */

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { nowInstant } from "@langwatch/time";

import { findScenarioAnnotations, isEntryModule } from "./check-feature-parity.ts";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "../../../..");
const PARITY_TOOL = join(dirname(__filename), "check-feature-parity.ts");
const DEFAULT_OUT = ".claude/handoffs/parity-candidates.tsv";

/** Below this score a scenario is reported as needing a new test. */
export const SCORE_FLOOR = 0.25;
const TOP_N = 3;

/** Multipliers and field weights; tuned against the bound scenarios with `--eval`. */
export const DEFAULT_WEIGHTS = {
  owned: 1.5,
  named: 1.3,
  level: 1.15,
  literal: 2,
  assert: 1,
  title: 0.8,
  body: 0.4,
};

export type Weights = typeof DEFAULT_WEIGHTS;
/** A term in more than this share of tests says nothing about which one proves a scenario. */
const COMMON_TERM_SHARE = 0.2;
const COMMON_TERM_FLOOR = 50;
/** Without a title list, every 25th bound scenario is measured: a stable sample. */
const EVAL_SAMPLE_STRIDE = 25;
const MAX_BLOCK_LINES = 200;

export type Level = "unit" | "integration" | "e2e" | "other";

export interface ScenarioQuery {
  feature: string;
  title: string;
  line: number;
  level: Level;
  steps: string[];
}

export interface TestBlock {
  file: string;
  line: number;
  title: string;
  level: Level;
  /** Every term in the block, describe titles included. */
  terms: Set<string>;
  /** Terms on assertion and query lines (`expect`, `getByText`, ...). */
  assertTerms: Set<string>;
  /** Terms of the `it` title and its enclosing describes. */
  titleTerms: Set<string>;
  /** Scenario titles whose `@scenario` annotation sits on this block. */
  boundTitles: string[];
  /** Feature files the test file names, e.g. `// Spec: specs/x/y.feature`. */
  specRefs: string[];
}

export interface Candidate {
  block: TestBlock;
  score: number;
  why: string;
}

const STOPWORDS = new Set(
  (
    "the and but for with that this then when given are was were has have had not its " +
    "into from onto than them they their there what which who whom will would can could " +
    "should does did done one two any all each every some only also just more most less " +
    "same other another still yet very been being because before after while until " +
    "const let var await async return function import export type interface true false " +
    "null undefined new expect describe test toBe toEqual tobe toequal mock vitest void"
  ).split(" "),
);

/** A crude stemmer: enough that "proves", "proved" and "proving" meet "prove". */
export function stem(word: string): string {
  let w = word;
  if (w.length <= 3) return w;
  if (w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("es") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w.length > 4 && w.endsWith("e") ? w.slice(0, -1) : w;
}

const IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_]*|\d+/g;

/** Words, split on camelCase and snake_case, plus each whole compound identifier. */
export function termsOf(text: string): string[] {
  const out: string[] = [];

  for (const raw of text.match(IDENTIFIER_RE) ?? []) {
    if (/^\d+$/.test(raw)) {
      if (raw.length >= 2) out.push(raw);
      continue;
    }

    const parts = raw
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/[\s_]+/)
      .map((p) => p.toLowerCase())
      .filter((p) => p.length >= 3 && !STOPWORDS.has(p));

    if (parts.length > 1) out.push(raw.toLowerCase());
    for (const p of parts) out.push(stem(p));
  }

  return out;
}

/** Quoted strings, codes, routes and numbers in a scenario: the terms worth double. */
export function literalTermsOf(text: string): Set<string> {
  const literals = new Set<string>();
  const quoted = text.match(/"[^"]+"|`[^`]+`|'[^'\s][^']*[^'\s]'/g) ?? [];
  const shaped = text.match(/\/[\w/:-]+|\b\w+_\w+\b|\b[a-z]+[A-Z]\w*\b|\b\d{2,}\b/g) ?? [];

  for (const chunk of [...quoted, ...shaped]) {
    for (const term of termsOf(chunk)) literals.add(term);
  }

  return literals;
}

/** The steps under the scenario at 1-based `line`, examples tables included. */
export function scenarioSteps({ source, line }: { source: string; line: number }): string[] {
  const lines = source.split("\n");
  const steps: string[] = [];

  for (let i = line; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    if (/^(?:Scenario|Rule:|Feature:|@)/.test(trimmed)) break;
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    steps.push(trimmed);
  }

  return steps;
}

/** The level tag on the tag lines above `line`, falling back to the feature's own. */
export function levelAbove({ source, line }: { source: string; line: number }): Level {
  const lines = source.split("\n");
  const tags: string[] = [];

  for (let i = line - 2; i >= 0; i--) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed.startsWith("@")) tags.push(...trimmed.split(/\s+/));
    else if (trimmed !== "" && !trimmed.startsWith("#")) break;
  }

  const featureAt = lines.findIndex((l) => l.trim().startsWith("Feature:"));
  for (const l of lines.slice(0, Math.max(featureAt, 0))) {
    if (l.trim().startsWith("@")) tags.push(...l.trim().split(/\s+/));
  }

  return levelOfTags(tags);
}

export function levelOfTags(tags: readonly string[]): Level {
  if (tags.includes("@unit")) return "unit";
  if (tags.includes("@integration")) return "integration";
  if (tags.includes("@e2e")) return "e2e";
  return "other";
}

function levelOfFile(file: string): Level {
  if (/\.unit\.test\./.test(file)) return "unit";
  if (/\.integration\.test\./.test(file)) return "integration";
  if (/\.e2e\.|\/e2e\//.test(file)) return "e2e";
  return "other";
}

const BLOCK_RE =
  /^(\s*)(?:it|test|describe)(?:\.(?:only|skip|todo|concurrent|fails|each\s*\([^)]*\)))*\s*\(\s*(["'`])((?:\\.|(?!\2).)*)\2/;
const ASSERT_RE =
  /expect\(|assert|toThrow|toHave|toMatch|toContain|toBe|toEqual|rejects|(?:get|find|query)(?:All)?By/;
const SPEC_REF_RE = /[\w./-]+\.feature\b/g;

/** Splits a test file into `it`/`test` blocks with their describe path. */
export function testBlocksOf({ file, src }: { file: string; src: string }): TestBlock[] {
  const lines = src.split("\n");
  const specRefs = [...new Set((src.match(SPEC_REF_RE) ?? []).map((r) => r.split("/").pop() ?? r))];
  const heads: { at: number; indent: number; kind: string; title: string }[] = [];

  lines.forEach((l, at) => {
    const m = BLOCK_RE.exec(l);
    if (!m) return;
    const kind = l.trim().startsWith("describe") ? "describe" : "it";
    heads.push({ at, indent: (m[1] ?? "").length, kind, title: m[3] ?? "" });
  });

  const annotations = findScenarioAnnotations(src).map((a) => ({
    title: a.title,
    line: src.slice(0, a.index).split("\n").length - 1,
  }));

  const blocks: TestBlock[] = [];
  const describes: { indent: number; title: string }[] = [];

  heads.forEach((h, k) => {
    while (describes.length > 0 && (describes.at(-1)?.indent ?? 0) >= h.indent) describes.pop();

    if (h.kind === "describe") {
      describes.push({ indent: h.indent, title: h.title });
      return;
    }

    const next = heads.slice(k + 1).find((o) => o.indent <= h.indent);
    const end = Math.min(next?.at ?? lines.length, h.at + MAX_BLOCK_LINES);
    const body = lines.slice(h.at, end).filter((l) => !l.includes("@scenario"));
    const titleText = [...describes.map((d) => d.title), h.title].join(" ");
    const previous = heads[k - 1]?.at ?? -1;

    blocks.push({
      file,
      line: h.at + 1,
      title: h.title,
      level: levelOfFile(file),
      terms: new Set([...termsOf(body.join("\n")), ...termsOf(titleText)]),
      assertTerms: new Set(termsOf(body.filter((l) => ASSERT_RE.test(l)).join("\n"))),
      titleTerms: new Set(termsOf(titleText)),
      boundTitles: annotations
        .filter((a) => a.line > previous && a.line < h.at)
        .map((a) => a.title),
      specRefs,
    });
  });

  return blocks;
}

export interface TestIndex {
  blocks: TestBlock[];
  postings: Map<string, number[]>;
  idf: (term: string) => number;
}

export function buildIndex(blocks: TestBlock[]): TestIndex {
  const postings = new Map<string, number[]>();

  blocks.forEach((b, i) => {
    for (const t of b.terms) {
      const list = postings.get(t);
      if (list) list.push(i);
      else postings.set(t, [i]);
    }
  });

  const n = blocks.length;
  const idf = (term: string) => Math.log(1 + n / (1 + (postings.get(term)?.length ?? 0)));

  return { blocks, postings, idf };
}

/** Module roots a feature belongs to: its own, or the catalogue's for its path words. */
export function ownerRootsOf({
  feature,
  catalogue,
}: {
  feature: string;
  catalogue: { root: string; names: string[] }[];
}): string[] {
  const own = /^((?:enterprise\/)?modules\/[^/]+)\//.exec(feature);
  if (own?.[1]) return [own[1]];

  const words = new Set(
    feature
      .replace(/\.feature$/, "")
      .split(/[/]/)
      .flatMap((seg) => [seg, ...seg.split("-")])
      .flatMap((w) => [w, stem(w)]),
  );

  return catalogue.filter((c) => c.names.some((n) => words.has(n))).map((c) => c.root);
}

/** Term weight times where it was found: assertion, title, or merely the body. */
export function rankCandidates({
  query,
  index,
  ownerRoots,
  tuning = DEFAULT_WEIGHTS,
}: {
  query: ScenarioQuery;
  index: TestIndex;
  ownerRoots: readonly string[];
  tuning?: Weights;
}): Candidate[] {
  const literals = literalTermsOf([query.title, ...query.steps].join("\n"));
  const terms = [...new Set(termsOf([query.title, ...query.steps].join("\n")))];
  const weights = new Map(
    terms.map((t) => [t, index.idf(t) * (literals.has(t) ? tuning.literal : 1)]),
  );
  const total = [...weights.values()].reduce((a, w) => a + w, 0);
  if (total === 0) return [];

  const { raw, touched } = accumulate({ weights, index, tuning });
  const featureName = query.feature.split("/").pop() ?? "";
  let best: Ranked[] = [];

  for (const i of touched) {
    const block = index.blocks[i]!;
    const owned = ownerRoots.some((root) => block.file.startsWith(`${root}/`));
    const named = block.specRefs.includes(featureName);
    const sameLevel = query.level !== "other" && block.level === query.level;
    const score =
      ((raw[i] ?? 0) / total) *
      (owned ? tuning.owned : 1) *
      (named ? tuning.named : 1) *
      (sameLevel ? tuning.level : 1);
    if (best.length === TOP_N && score <= (best.at(-1)?.score ?? 0)) continue;
    best = keepTop([...best, { block, score, flags: { named, owned, sameLevel } }]);
  }

  return best.map((r) => ({
    block: r.block,
    score: r.score,
    why: whyOf({ ranked: r, weights, tuning }),
  }));
}

interface Ranked {
  block: TestBlock;
  score: number;
  flags: { named: boolean; owned: boolean; sameLevel: boolean };
}

const keepTop = (ranked: Ranked[]) => ranked.toSorted((x, y) => y.score - x.score).slice(0, TOP_N);

/** Term-at-a-time: each term's postings add its weight to the tests holding it. */
function accumulate({
  weights,
  index,
  tuning,
}: {
  weights: Map<string, number>;
  index: TestIndex;
  tuning: Weights;
}): { raw: Float64Array; touched: number[] } {
  const raw = new Float64Array(index.blocks.length);
  const touched: number[] = [];
  const common = Math.max(COMMON_TERM_FLOOR, index.blocks.length * COMMON_TERM_SHARE);

  for (const [term, w] of weights) {
    const list = index.postings.get(term) ?? [];
    if (list.length > common) continue;
    for (const i of list) {
      if (raw[i] === 0) touched.push(i);
      raw[i] = (raw[i] ?? 0) + w * fieldOf({ block: index.blocks[i], term, tuning });
    }
  }

  return { raw, touched };
}

function whyOf({
  ranked: { block, flags },
  weights,
  tuning,
}: {
  ranked: Ranked;
  weights: Map<string, number>;
  tuning: Weights;
}): string {
  const hits = [...weights]
    .filter(([term]) => block.terms.has(term))
    .map(([term, w]) => ({ term, gain: w * fieldOf({ block, term, tuning }) }))
    .toSorted((x, y) => y.gain - x.gain)
    .slice(0, 5)
    .map((h) => h.term);
  const named = flags.named ? ["names-feature"] : [];
  const owned = flags.owned ? ["same-module"] : [];
  const level = flags.sameLevel ? [block.level] : [];
  return [...named, ...owned, ...level, hits.join(",")].join(" ");
}

/** Where a term sits in a test: an assertion counts most, the body alone least. */
function fieldOf({
  block,
  term,
  tuning,
}: {
  block: TestBlock | undefined;
  term: string;
  tuning: Weights;
}): number {
  if (!block) return 0;
  if (block.assertTerms.has(term)) return tuning.assert;
  return block.titleTerms.has(term) ? tuning.title : tuning.body;
}

const TSV_HEADER = [
  "feature",
  "line",
  "scenario",
  "level",
  ...[1, 2, 3].flatMap((n) => [`c${n}_test`, `c${n}_it`, `c${n}_score`, `c${n}_why`]),
].join("\t");

const cell = (s: string) => s.replace(/[\t\r\n]+/g, " ");

export function tsvRow({
  query,
  candidates,
}: {
  query: ScenarioQuery;
  candidates: Candidate[];
}): string {
  const fixed = [query.feature, String(query.line), query.title, query.level];
  const above = candidates.filter((c) => c.score >= SCORE_FLOOR);

  if (above.length === 0) return [...fixed, "no candidate"].map(cell).join("\t");

  const cols = above.flatMap((c) => [
    `${c.block.file}:${c.block.line}`,
    c.block.title,
    c.score.toFixed(2),
    c.why,
  ]);

  return [...fixed, ...cols].map(cell).join("\t");
}

interface ParityScenario {
  title: string;
  tags: string[];
  line: number;
  bindings?: unknown[];
}

interface ParityJson {
  enforced: { feature: string; scenarios: ParityScenario[]; unbound: ParityScenario[] }[];
  legacy: { feature: string; unboundTitles: string[] }[];
}

/** Stdout goes to a file: the parity tool exits 1 mid-write, which truncates a pipe. */
function readParity(): ParityJson {
  const dir = mkdtempSync(join(tmpdir(), "parity-"));
  const out = join(dir, "parity.json");
  const fd = openSync(out, "w");
  spawnSync(process.execPath, ["--experimental-transform-types", PARITY_TOOL, "--json"], {
    stdio: ["ignore", fd, "inherit"],
  });
  closeSync(fd);
  const parsed = JSON.parse(readFileSync(out, "utf8")) as ParityJson;
  rmSync(dir, { recursive: true, force: true });
  return parsed;
}

function queryFor({
  feature,
  title,
  line,
}: {
  feature: string;
  title: string;
  line: number;
}): ScenarioQuery {
  const source = readFileSync(resolve(REPO_ROOT, feature), "utf8");
  const at =
    line > 0
      ? line
      : source.split("\n").findIndex((l) => /^\s*Scenario/.test(l) && l.includes(title)) + 1;
  return {
    feature,
    title,
    line: at,
    level: levelAbove({ source, line: at }),
    steps: scenarioSteps({ source, line: at }),
  };
}

function loadIndex(): TestIndex {
  const listed = spawnSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const files = listed.stdout
    .split("\n")
    .filter((f) => /\.(?:test|spec)\.(?:tsx?|mjs)$/.test(f) && !f.includes("node_modules"))
    .filter((f) => !f.startsWith(".worktrees/") && existsSync(resolve(REPO_ROOT, f)));

  return buildIndex(
    files.flatMap((file) =>
      testBlocksOf({ file, src: readFileSync(resolve(REPO_ROOT, file), "utf8") }),
    ),
  );
}

function loadCatalogue(): { root: string; names: string[] }[] {
  const raw = JSON.parse(readFileSync(resolve(REPO_ROOT, "modules/catalogue.json"), "utf8")) as {
    features: { id: string; root: string; subjects?: string[] }[];
  };
  return raw.features.map((f) => ({ root: f.root, names: [f.id, ...(f.subjects ?? [])] }));
}

/** Top-3 hit rate over scenarios that are bound, the annotation itself hidden from the ranker. */
function evaluate({
  parity,
  index,
  titles,
}: {
  parity: ParityJson;
  index: TestIndex;
  titles: Set<string> | null;
}) {
  const catalogue = loadCatalogue();
  const bound = parity.enforced.flatMap((r) =>
    r.scenarios
      .filter((s) => (s.bindings?.length ?? 0) > 0 && (!titles || titles.has(s.title)))
      .map((s) => ({ feature: r.feature, title: s.title, line: s.line })),
  );
  const measured = titles ? bound : bound.filter((_, i) => i % EVAL_SAMPLE_STRIDE === 0);
  const misses = measured.filter((s) => {
    const ranked = rankCandidates({
      query: queryFor(s),
      index,
      ownerRoots: ownerRootsOf({ feature: s.feature, catalogue }),
    });
    return !ranked.some((c) => c.score >= SCORE_FLOOR && c.block.boundTitles.includes(s.title));
  });

  return {
    tried: measured.length,
    hit: measured.length - misses.length,
    misses: misses.map((m) => `${m.feature}\t${m.title}`),
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const started = nowInstant().epochMilliseconds;
  const parity = readParity();
  const index = loadIndex();
  const evalAt = args.indexOf("--eval");

  if (evalAt >= 0) {
    const listFile = args[evalAt + 1];
    const titles = listFile
      ? new Set(
          readFileSync(listFile, "utf8")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean),
        )
      : null;
    const { tried, hit, misses } = evaluate({ parity, index, titles });
    console.log(
      `top-${TOP_N} precision: ${hit}/${tried} (${((100 * hit) / Math.max(tried, 1)).toFixed(1)}%)`,
    );
    if (titles) for (const m of misses) console.log(`miss\t${m}`);
    console.log(
      `runtime: ${((nowInstant().epochMilliseconds - started) / 1000).toFixed(1)}s over ${index.blocks.length} tests`,
    );
    return;
  }

  const catalogue = loadCatalogue();
  const unbound = [
    ...parity.enforced.flatMap((r) =>
      r.unbound.map((s) => ({ feature: r.feature, title: s.title, line: s.line })),
    ),
    ...parity.legacy.flatMap((r) =>
      r.unboundTitles.map((title) => ({ feature: r.feature, title, line: 0 })),
    ),
  ];

  let none = 0;
  const rows = unbound.map((u) => {
    const query = queryFor(u);
    const candidates = rankCandidates({
      query,
      index,
      ownerRoots: ownerRootsOf({ feature: u.feature, catalogue }),
    });
    if (!candidates.some((c) => c.score >= SCORE_FLOOR)) none++;
    return tsvRow({ query, candidates });
  });

  const outAt = args.indexOf("--out");
  const out = resolve(REPO_ROOT, (outAt >= 0 ? args[outAt + 1] : undefined) ?? DEFAULT_OUT);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${[TSV_HEADER, ...rows].join("\n")}\n`);
  console.log(`${rows.length} unbound scenarios, ${none} with no candidate -> ${out}`);
  console.log(
    `runtime: ${((nowInstant().epochMilliseconds - started) / 1000).toFixed(1)}s over ${index.blocks.length} tests`,
  );
}

if (isEntryModule({ invokedPath: process.argv[1], modulePath: __filename })) main();
