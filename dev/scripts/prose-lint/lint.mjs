#!/usr/bin/env node
// prose-lint: a prose linter for docs and posts that uses TypeSafe Jev as the
// judge. One boolean question per writing rule per section, regex rules run
// locally, a second Jev request locates the offending sentence for rules that
// fired. See README.md.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
const PRICE_PER_MTOK = 0.042; // USD per million input tokens, output is free
const TOKEN_BUDGET = 30000; // state cap is 32k tokens, text and questions together
const MAX_CHOICE_OPTIONS = 255;
const REQUEST_TIMEOUT_MS = 120000;

// ---------- args ----------

function parseArgs(argv) {
  const opts = {
    files: [],
    rules: "docs",
    sectionLevel: 2,
    json: false,
    threshold: 0.7,
    min: 0.5,
    locate: 0.6,
    noLocate: false,
    concurrency: 4,
    only: null,
    skip: null,
    context: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--rules") opts.rules = next();
    else if (a === "--section-level") opts.sectionLevel = Number(next());
    else if (a === "--json") opts.json = true;
    else if (a === "--threshold") opts.threshold = probability(a, next());
    else if (a === "--min") opts.min = probability(a, next());
    else if (a === "--locate") opts.locate = probability(a, next());
    else if (a === "--no-locate") opts.noLocate = true;
    else if (a === "--context") opts.context = true;
    else if (a === "--concurrency") opts.concurrency = positiveInteger(a, next());
    else if (a === "--only") opts.only = new Set(next().split(","));
    else if (a === "--skip") opts.skip = new Set(next().split(","));
    else if (a === "-h" || a === "--help") {
      usage();
      process.exit(0);
    } else if (a.startsWith("-")) {
      console.error(`unknown flag ${a}`);
      usage();
      process.exit(2);
    } else opts.files.push(a);
  }
  if (opts.files.length === 0) {
    usage();
    process.exit(2);
  }
  return opts;
}

// A flag that takes a probability: a finite number from 0 to 1. Anything else
// would silently make every rule fire, or none, so it is refused up front.
function probability(flag, raw) {
  const value = Number(raw);
  if (raw === undefined || raw === "" || !Number.isFinite(value) || value < 0 || value > 1) {
    console.error(
      `${flag} takes a number from 0 to 1, got ${raw === undefined ? "nothing" : JSON.stringify(raw)}`,
    );
    process.exit(2);
  }
  return value;
}

function positiveInteger(flag, raw) {
  const value = Number(raw);
  if (raw === undefined || raw === "" || !Number.isInteger(value) || value < 1) {
    console.error(
      `${flag} takes a whole number of 1 or more, got ${raw === undefined ? "nothing" : JSON.stringify(raw)}`,
    );
    process.exit(2);
  }
  return value;
}

function usage() {
  console.error(`usage: node lint.mjs <file.md|mdx> [more files] [options]
  --rules docs|writing|both|landing   rule set (default docs; landing loads landing-page-writing plus writing)
  --section-level N           split the file at headings of this level and above (default 2)
  --json                      machine output
  --threshold P               exit 1 when any rule fires at or above P (default 0.7)
  --min P                     report rules at or above P (default 0.5)
  --locate P                  ask which sentence for rules at or above P (default 0.6)
  --no-locate                 skip the sentence-locating request
  --context                   give the judge every section above the one it reads, for rules marked "context" (landing rules 2 and 9)
  --concurrency N             sections judged in parallel (default 4)
  --only a,b,c                run only these rule ids
  --skip a,b,c                skip these rule ids`);
}

// ---------- key ----------

const REPO_ROOT = join(HERE, "..", "..", "..");
const DOCS_DIR = join(REPO_ROOT, "docs");

// JEV_API_KEY wins over TYPESAFE_API_KEY wherever it is set: the environment
// first, then the dotenv files the repo already keeps keys in.
function loadKey(env = process.env) {
  const files = [
    join(HERE, ".env"),
    join(DOCS_DIR, ".env"),
    join(REPO_ROOT, "platform", "app", ".env"),
  ];
  for (const name of ["JEV_API_KEY", "TYPESAFE_API_KEY"]) {
    if (env[name]) return env[name];
    for (const file of files) {
      const value = readDotenv(file, name);
      if (value) return value;
    }
  }
  throw new Error(
    "no Jev key: set JEV_API_KEY (or TYPESAFE_API_KEY) in the environment, in dev/scripts/prose-lint/.env, in docs/.env, or in platform/app/.env",
  );
}

function readDotenv(file, name) {
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(new RegExp(`^\\s*(?:export\\s+)?${name}=\\s*"?([^"'\\s]+)"?`));
    if (m) return m[1];
  }
  return null;
}

// ---------- rules ----------

function loadRules(which, only, skip) {
  const sets =
    which === "both" ? ["docs", "writing"] : which === "landing" ? ["landing", "writing"] : [which];
  const out = [];
  const seen = new Set();
  const amend = {};
  for (const set of sets) {
    const file = join(HERE, "rules", `${set}.json`);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    Object.assign(amend, doc.amend ?? {});
    for (const r of doc.rules) {
      if (seen.has(r.id)) continue; // shared rules (em-dash) run once
      seen.add(r.id);
      const key = `${set}/${r.id}`;
      if (only && !only.has(r.id) && !only.has(key)) continue;
      if (skip && (skip.has(r.id) || skip.has(key))) continue;
      const extra = amend[r.id];
      out.push(
        extra && r.kind === "judge"
          ? { ...r, set, key, instruction: `${r.instruction} ${extra}` }
          : { ...r, set, key },
      );
    }
  }
  return out;
}

// A sentence the founder supplied verbatim is marked "[founder]" in the copy
// file. Findings the judge locates on one are reported but never fail the run
// (landing-page-writing rule 13); regex bans still apply to them.
const FOUNDER_MARK = /\s*\[founder\]\s*$/;
const isFounder = (sentence) => typeof sentence === "string" && FOUNDER_MARK.test(sentence.trim());

// The mark sits at the end of the line the founder supplied, so every sentence
// of that line is his, not only the one carrying the mark. Other lines of the
// same block (the earlier items of a list, the line above in a paragraph) are
// not covered by it.
function founderUnitsIn(paragraphs) {
  const marked = new Set();
  const plain = new Set();
  for (const p of paragraphs) {
    const founderLines = p.text
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(isFounder);
    for (const u of p.units) {
      if (isFounder(u) || founderLines.some((l) => l.includes(u))) marked.add(u);
      else plain.add(u);
    }
  }
  // The judge answers with sentence text, so the same sentence on a marked and
  // an unmarked line is one choice. It keeps failing: the exemption is the
  // claim that needs proof.
  for (const u of plain) marked.delete(u);
  return marked;
}

// ---------- document parsing ----------

function parseFrontmatter(src) {
  if (!src.startsWith("---")) return { frontmatter: {}, body: src };
  const end = src.indexOf("\n---", 3);
  if (end < 0) return { frontmatter: {}, body: src };
  const block = src.slice(3, end);
  const frontmatter = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) frontmatter[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  const rest = src.slice(end + 4);
  return { frontmatter, body: rest.replace(/^\n/, "") };
}

function splitSections(body, level) {
  const lines = body.split("\n");
  const sections = [];
  let current = { heading: "", level: 0, lines: [] };
  let inCode = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inCode = !inCode;
    const m = !inCode && line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (m && m[1].length <= level) {
      if (current.lines.some((l) => l.trim()) || current.heading) sections.push(current);
      current = { heading: m[2], level: m[1].length, lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.some((l) => l.trim()) || current.heading) sections.push(current);
  return sections.map((s, i) => ({
    index: i,
    heading: s.heading,
    level: s.level,
    text: (
      (s.heading ? `${"#".repeat(s.level)} ${s.heading}\n\n` : "") + s.lines.join("\n")
    ).trim(),
    paragraphs: splitParagraphs(s.lines),
  }));
}

// Paragraphs are blank-line separated blocks, classified so regex and local
// checks can skip code and keep table rows and list items as their own units.
function splitParagraphs(lines) {
  const paras = [];
  let buf = [];
  let inCode = false;
  const flush = (kind) => {
    if (buf.length) paras.push(classify(buf, kind));
    buf = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (inCode) {
        buf.push(line);
        flush("code");
        inCode = false;
      } else {
        flush();
        inCode = true;
        buf.push(line);
      }
      continue;
    }
    if (inCode) {
      buf.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    buf.push(line);
  }
  flush(inCode ? "code" : undefined);
  return paras;
}

function classify(lines, kind) {
  const text = lines.join("\n");
  if (kind === "code") return { kind, text, units: [] };
  const first = lines[0].trim();
  const exempt = /Founder decision/.test(text);
  if (/^#{1,6}\s/.test(first) && lines.length === 1) {
    return { kind: "heading", text, exempt, units: [first.replace(/^#+\s*/, "")] };
  }
  if (lines.every((l) => /^\s*\|/.test(l))) {
    const rows = lines
      .filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l))
      .map((l) =>
        l
          .replace(/^\s*\||\|\s*$/g, "")
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean)
          .join(". "),
      );
    return { kind: "table", text, exempt, units: rows };
  }
  if (lines.every((l) => /^\s*([-*+]|\d+[.)])\s/.test(l) || /^\s{2,}\S/.test(l))) {
    const items = [];
    for (const l of lines) {
      if (/^\s*([-*+]|\d+[.)])\s/.test(l)) items.push(l.replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
      else if (items.length) items[items.length - 1] += " " + l.trim();
    }
    return { kind: "list", text, exempt, units: items.map(stripMarkup).flatMap(splitSentences) };
  }
  if (lines.every((l) => /^\s*<\/?[A-Z][\w.]*[^>]*>\s*$/.test(l))) {
    return { kind: "tag", text, exempt, units: [] };
  }
  // Stripped over the whole paragraph rather than per sentence, so a comment
  // or an image that spans a sentence boundary never leaks half of itself
  // into a unit.
  const prose = stripMarkup(
    lines
      .map((l) => l.replace(/^\s*<\/?[A-Z][\w.]*[^>]*>\s*$/, "").trim())
      .filter(Boolean)
      .join(" "),
  );
  return {
    kind: "prose",
    text,
    exempt,
    units: splitSentences(prose),
    words: prose.split(/\s+/).length,
  };
}

function splitSentences(s) {
  const clean = s.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  return clean
    .split(/(?<=[.!?])["')\]]?\s+(?=["'([`*_]?[A-Z0-9])/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

// Markup that is not prose and carries punctuation the regex rules would
// otherwise count: an image's leading exclamation mark, a comment's arrow.
// Both go entirely, so nothing is left for a rule to match.
function stripMarkup(s) {
  return s.replace(/<!--[\s\S]*?-->/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "");
}

function stripInlineCode(s) {
  return stripMarkup(s).replace(/`[^`]*`/g, "`code`");
}

// ---------- regex and local rules ----------

function runRegexRules(rules, section, doc, docCounts) {
  const findings = [];
  for (const r of rules) {
    if (r.kind !== "regex") continue;
    const re = new RegExp(r.pattern, r.flags ?? "gi");
    let hits = [];
    if (r.target === "raw") {
      for (const m of section.text.matchAll(re))
        hits.push({ sentence: m[0].slice(0, 200), match: m[0] });
    } else if (r.target === "headings") {
      const heads = [
        section.heading ? `${"#".repeat(section.level)} ${section.heading}` : "",
      ].concat(section.paragraphs.filter((p) => p.kind === "heading").map((p) => p.text.trim()));
      for (const h of heads) {
        // The pattern carries the g flag, so test() would resume from where
        // the previous heading matched and skip a hit at the start of this one.
        re.lastIndex = 0;
        if (h && re.test(h)) hits.push({ sentence: h, match: h });
      }
    } else {
      for (const p of section.paragraphs) {
        if (p.kind === "code" || p.kind === "tag" || p.exempt) continue;
        for (const u of p.units) {
          const probe = stripInlineCode(u);
          const m = probe.match(re);
          if (m) hits.push({ sentence: u, match: m[0] });
        }
      }
    }
    if (r.documentMax != null) {
      // count across the whole document, fire only past the cap
      docCounts[r.key] = (docCounts[r.key] ?? 0) + hits.length;
      if (hits.length)
        findings.push({
          rule: r,
          probability: 1,
          sentence: hits[0].sentence,
          match: hits[0].match,
          deferred: true,
          count: hits.length,
        });
      continue;
    }
    if (hits.length) {
      findings.push({
        rule: r,
        probability: 1,
        sentence: hits[0].sentence,
        match: hits[0].match,
        count: hits.length,
        all: hits.map((h) => h.sentence),
      });
    }
  }
  return findings;
}

function runLocalRules(rules, section, doc) {
  const findings = [];
  for (const r of rules) {
    if (r.kind !== "local") continue;
    if (r.check === "paragraph-words") {
      const over = section.paragraphs.filter(
        (p) => (p.kind === "prose" || p.kind === "list") && !p.exempt && countWords(p) > r.max,
      );
      if (over.length) {
        const p = over[0];
        findings.push({
          rule: r,
          probability: 1,
          sentence: `${countWords(p)} words: ${p.units[0] ?? p.text.slice(0, 120)}`,
          count: over.length,
        });
      }
    } else if (r.check === "one-sentence-paragraph-run") {
      let run = 0;
      let best = 0;
      let at = null;
      for (const p of section.paragraphs) {
        if (p.kind === "prose" && p.units.length === 1) {
          run++;
          if (run > best) {
            best = run;
            at = p;
          }
        } else run = 0;
      }
      if (best > r.max)
        findings.push({
          rule: r,
          probability: 1,
          sentence: `${best} one-sentence paragraphs in a row, ending: ${at.units[0]}`,
        });
    } else if (r.check === "title-repeated-as-heading" && section.index === 0) {
      const title = (doc.frontmatter.title ?? "").toLowerCase();
      const first = doc.firstHeading?.toLowerCase();
      if (title && first && title === first)
        findings.push({
          rule: r,
          probability: 1,
          sentence: `title and first heading are both "${doc.frontmatter.title}"`,
        });
    } else if (r.check === "title-how-to" && section.index === 0) {
      const title = doc.frontmatter.title ?? "";
      if (/^how to\b/i.test(title))
        findings.push({ rule: r, probability: 1, sentence: `title: ${title}` });
    }
  }
  return findings;
}

function countWords(p) {
  if (p.kind === "list") return Math.max(...p.units.map((u) => u.split(/\s+/).length), 0);
  return p.words ?? 0;
}

// ---------- Jev ----------

class MaxTokens extends Error {}

async function jev(key, state, questions, usage) {
  const body = JSON.stringify({ state, model: MODEL, questions });
  let attempt = 0;
  for (;;) {
    attempt++;
    let res;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body,
        // A hung request becomes a failed attempt and is retried like a
        // dropped socket, instead of holding the section forever.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      if (attempt >= 6) throw e;
      await sleep(backoff(attempt));
      continue;
    }
    const text = await res.text();
    if (res.status === 200) {
      const out = JSON.parse(text);
      usage.requests++;
      usage.inputTokens += out.usage?.input_tokens ?? 0;
      return out;
    }
    if (res.status === 400 && /max_tokens_exceeded/.test(text))
      throw new MaxTokens(text.slice(0, 200));
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      if (attempt >= 6)
        throw new Error(`HTTP ${res.status} after ${attempt} attempts: ${text.slice(0, 200)}`);
      const ra = Number(res.headers.get("retry-after"));
      await sleep(ra > 0 ? ra * 1000 : backoff(attempt));
      continue;
    }
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (n) => (1 << Math.min(n, 4)) * 1000 * (0.5 + Math.random() * 0.5);
const estimateTokens = (s) => Math.ceil(s.length / 3.2);

function noul(rule) {
  return {
    type: "noul",
    instructions: rule.instruction,
    criteria: { true: rule.yes, false: rule.no },
  };
}

// Sends the questions over one state, splitting the questions (never the
// state) across requests when the token budget or the API says so.
async function askInBatches(key, state, questions, usage) {
  const stateTokens = estimateTokens(JSON.stringify(state));
  if (stateTokens > TOKEN_BUDGET)
    throw new Error(
      `section text alone is ~${stateTokens} tokens, over the ${TOKEN_BUDGET} budget; split it with a lower --section-level`,
    );
  const entries = Object.entries(questions);
  const answers = {};
  const queue = [entries];
  while (queue.length) {
    const batch = queue.shift();
    const qTokens = estimateTokens(JSON.stringify(Object.fromEntries(batch)));
    if (batch.length > 1 && stateTokens + qTokens > TOKEN_BUDGET) {
      const mid = Math.ceil(batch.length / 2);
      queue.push(batch.slice(0, mid), batch.slice(mid));
      continue;
    }
    try {
      const out = await jev(key, state, Object.fromEntries(batch), usage);
      Object.assign(answers, out.answers);
    } catch (e) {
      if (e instanceof MaxTokens && batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        queue.push(batch.slice(0, mid), batch.slice(mid));
        continue;
      }
      throw e;
    }
  }
  return answers;
}

const hasContent = (section) =>
  section.paragraphs.some((p) => p.kind === "code" || p.units.length > 0);

// The state a section is judged in. `withAbove` adds everything the reader
// has seen before this block, so a rule can ask whether the block is
// understandable from the page above it alone. Only the rules marked
// "context" get it: for every other rule the page above is tokens paid for
// nothing, and a judge reading a whole page may answer about the wrong block.
function sectionState(section, doc, { withAbove = false } = {}) {
  const state = { heading: section.heading || "(no heading)", text: section.text };
  if (withAbove) {
    const above = doc.sections
      .slice(0, section.index)
      .map((s) => s.text)
      .join("\n\n");
    state.above = above || "(nothing: this is the first block on the page)";
  }
  if (section.index === doc.firstContentIndex) {
    if (doc.frontmatter.title) state.title = doc.frontmatter.title;
    if (doc.frontmatter.description) state.description = doc.frontmatter.description;
  }
  return state;
}

// Sends one set of questions per kind of state: the ordinary rules over the
// section alone, the contextual rules over the section plus the page above.
// Returns every answer keyed by question, whichever request carried it.
async function askByContext(key, section, doc, items, toQuestion, usage) {
  const answers = {};
  for (const withAbove of [false, true]) {
    const batch = items.filter((item) => Boolean(item.rule.context) === withAbove);
    if (batch.length === 0) continue;
    const state = sectionState(section, doc, { withAbove });
    const questions = Object.fromEntries(batch.map((item) => [item.rule.key, toQuestion(item)]));
    Object.assign(answers, await askInBatches(key, state, questions, usage));
  }
  return answers;
}

async function judgeSection(key, rules, section, doc, opts, usage) {
  if (!hasContent(section)) return []; // a bare heading has nothing to judge
  const judge = rules.filter(
    (r) =>
      r.kind === "judge" &&
      (r.scope !== "first-section" || section.index === doc.firstContentIndex) &&
      (!r.context || doc.context),
  );
  if (judge.length === 0) return [];
  const answers = await askByContext(
    key,
    section,
    doc,
    judge.map((rule) => ({ rule })),
    ({ rule }) => noul(rule),
    usage,
  );
  const findings = [];
  for (const r of judge) {
    const a = answers[r.key];
    if (!a) continue;
    findings.push({ rule: r, probability: a.noul ?? a.probabilities?.true ?? 0 });
  }
  return findings;
}

async function locateSentences(key, findings, section, doc, opts, usage) {
  // A finding that can fail the run is located even below --locate: without a
  // sentence there is no way to tell whether it sits on a founder line.
  const cutoff = Math.min(opts.locate, opts.threshold);
  const fired = findings.filter((f) => f.rule.kind === "judge" && f.probability >= cutoff);
  const prose = section.paragraphs.filter((p) => p.kind !== "code" && p.kind !== "tag");
  const sentences = prose.flatMap((p) => p.units);
  const founderUnits = founderUnitsIn(prose);
  const markFounder = (f) => {
    f.founder = isFounder(f.sentence) || founderUnits.has(f.sentence);
  };
  const targets = [];
  for (const f of fired) {
    // rules about the heading or the opener need no second request
    if (f.rule.locate === "heading")
      f.sentence = section.heading
        ? `${"#".repeat(section.level)} ${section.heading}`
        : sentences[0];
    else if (f.rule.locate === "first-sentence") f.sentence = sentences[0];
    else {
      targets.push(f);
      continue;
    }
    markFounder(f);
  }
  if (targets.length === 0) return;
  const uniq = [...new Set(sentences)].slice(0, MAX_CHOICE_OPTIONS);
  if (uniq.length < 2) {
    for (const f of targets) {
      f.sentence = uniq[0];
      markFounder(f);
    }
    return;
  }
  const criteria = Object.fromEntries(
    uniq.map((s, i) => [`s${i + 1}`, s.length > 400 ? s.slice(0, 400) + "..." : s]),
  );
  const answers = await askByContext(
    key,
    section,
    doc,
    targets,
    (f) => ({
      type: "choice",
      instructions: `Which sentence of \`text\` is the clearest instance of the following? ${f.rule.instruction}`,
      criteria,
    }),
    usage,
  );
  for (const f of targets) {
    const a = answers[f.rule.key];
    if (!a) continue;
    const pick = a.choice;
    f.sentence = criteria[pick];
    f.sentenceProbability = a.probabilities?.[pick];
    markFounder(f);
  }
}

// ---------- driver ----------

async function lintFile(file, rules, opts, key) {
  const src = readFileSync(file, "utf8");
  const { frontmatter, body } = parseFrontmatter(src);
  const sections = splitSections(body, opts.sectionLevel);
  const firstHeading = sections.find((s) => s.heading)?.heading;
  const firstContentIndex = Math.max(0, sections.findIndex(hasContent));
  const doc = {
    file,
    frontmatter,
    firstHeading,
    firstContentIndex,
    context: opts.context,
    sections,
  };
  const skipped = rules.filter((r) => r.context && !opts.context);
  if (skipped.length)
    console.error(`note: ${skipped.map((r) => r.key).join(", ")} need --context and were skipped`);
  if (opts.noLocate && /\[founder\]/.test(src))
    console.error(
      "note: --no-locate skips the sentence-locating request, so [founder] lines are not recognised and can fail the run",
    );
  const usage = { requests: 0, inputTokens: 0 };
  const docCounts = {};
  const results = Array.from({ length: sections.length });

  let next = 0;
  async function worker() {
    while (next < sections.length) {
      const i = next++;
      const section = sections[i];
      const findings = [
        ...runRegexRules(rules, section, doc, docCounts),
        ...runLocalRules(rules, section, doc),
      ];
      let error = null;
      try {
        findings.push(...(await judgeSection(key, rules, section, doc, opts, usage)));
        if (!opts.noLocate) await locateSentences(key, findings, section, doc, opts, usage);
      } catch (e) {
        error = e.message;
      }
      results[i] = { section, findings, error };
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));

  // document-level caps (exclamation marks) resolve after every section ran
  for (const r of results) {
    r.findings = r.findings.filter(
      (f) => !f.deferred || docCounts[f.rule.key] > f.rule.documentMax,
    );
  }

  const out = {
    file,
    rules: opts.rules,
    sections: results.map((r) => ({
      heading: r.section.heading,
      words: r.section.text.split(/\s+/).length,
      error: r.error,
      findings: r.findings
        .filter((f) => f.probability >= opts.min)
        .sort((a, b) => b.probability - a.probability)
        .map((f) => ({
          rule: f.rule.key,
          name: f.rule.name,
          kind: f.rule.kind,
          probability: round(f.probability),
          sentence: f.sentence ?? null,
          match: f.match ?? null,
          count: f.count ?? null,
          founder: f.rule.kind === "judge" && (f.founder ?? isFounder(f.sentence)),
        })),
    })),
    usage: { ...usage, usd: round((usage.inputTokens / 1e6) * PRICE_PER_MTOK, 6) },
  };
  out.failed = out.sections.some((s) =>
    s.findings.some((f) => f.probability >= opts.threshold && !f.founder),
  );
  return out;
}

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

function printReport(rep, opts) {
  const lines = [];
  lines.push(
    `${basename(rep.file)}  (${rep.rules} rules, ${rep.sections.length} sections, threshold ${opts.threshold})`,
  );
  lines.push("");
  for (const s of rep.sections) {
    lines.push(`## ${s.heading || "(intro)"}  [${s.words} words]`);
    if (s.error) lines.push(`  error: ${s.error}`);
    if (s.findings.length === 0) lines.push("  clean");
    for (const f of s.findings) {
      const flag = f.founder ? "f" : f.probability >= opts.threshold ? "!" : " ";
      const extra = f.count && f.count > 1 ? `  (${f.count} hits)` : "";
      lines.push(`${flag} ${f.probability.toFixed(2)}  ${f.rule}  ${f.name}${extra}`);
      if (f.sentence) lines.push(`        > ${f.sentence}`);
    }
    lines.push("");
  }
  lines.push(
    `cost: ${rep.usage.inputTokens.toLocaleString()} input tokens over ${rep.usage.requests} requests = USD ${rep.usage.usd.toFixed(4)} (${PRICE_PER_MTOK} USD per million)`,
  );
  return lines.join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let key;
  try {
    key = loadKey();
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const rules = loadRules(opts.rules, opts.only, opts.skip);
  const reports = [];
  for (const f of opts.files) reports.push(await lintFile(f, rules, opts, key));
  if (opts.json) {
    console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
  } else {
    for (const r of reports) console.log(printReport(r, opts) + "\n");
  }
  process.exit(reports.some((r) => r.failed) ? 1 : 0);
}

main().catch((e) => {
  console.error(e.stack ?? String(e));
  process.exit(2);
});
