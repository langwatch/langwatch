#!/usr/bin/env node
// Runs lint.mjs over fixtures/ with both rule sets and scores every rule
// against fixtures/expected.json. Prints a markdown table; the raw per-fixture
// probabilities land in fixtures/results.json.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures");
const threshold = Number(process.argv[2] ?? 0.7);

const expected = JSON.parse(readFileSync(join(FIX, "expected.json"), "utf8"));
const files = readdirSync(FIX).filter((f) => /\.(md|mdx)$/.test(f)).sort();
for (const f of files) if (!(f in expected)) console.error(`warning: ${f} has no entry in expected.json and is skipped`);
const labelled = files.filter((f) => f in expected);
files.length = 0;
files.push(...labelled);

const results = {};
let tokens = 0;
let requests = 0;
for (const f of files) {
  const run = spawnSync(
    process.execPath,
    [join(HERE, "lint.mjs"), join(FIX, f), "--rules", f.endsWith(".mdx") ? "both" : "writing", "--json", "--min", "0", "--threshold", String(threshold)],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status === 2) {
    console.error(`${f}: ${run.stderr}`);
    process.exit(2);
  }
  const rep = JSON.parse(run.stdout);
  tokens += rep.usage.inputTokens;
  requests += rep.usage.requests;
  const max = {};
  const sentence = {};
  for (const s of rep.sections) {
    if (s.error) console.error(`${f} / ${s.heading}: ${s.error}`);
    for (const fd of s.findings) {
      if ((max[fd.rule] ?? -1) < fd.probability) {
        max[fd.rule] = fd.probability;
        sentence[fd.rule] = fd.sentence;
      }
    }
  }
  results[f] = { max, sentence };
  console.error(`${f}: ${Object.values(max).filter((p) => p >= threshold).length} rules at or above ${threshold}`);
}
writeFileSync(join(FIX, "results.json"), JSON.stringify(results, null, 2));

// score per rule
const rules = new Set();
for (const f of files) for (const r of Object.keys(results[f].max)) rules.add(r);
for (const list of Object.values(expected)) for (const r of list) rules.add(r);

const rows = [];
for (const r of [...rules].sort()) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  const fps = [];
  const fns = [];
  for (const f of files) {
    const exp = (expected[f] ?? []).includes(r);
    const fired = (results[f].max[r] ?? 0) >= threshold;
    if (exp && fired) tp++;
    else if (exp && !fired) { fn++; fns.push(`${f} (${(results[f].max[r] ?? 0).toFixed(2)})`); }
    else if (!exp && fired) { fp++; fps.push(`${f} (${results[f].max[r].toFixed(2)})`); }
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  rows.push({ r, tp, fp, fn, tn, precision, recall, fps, fns });
}

const fmt = (x) => (x == null ? "n/a" : (x * 100).toFixed(0) + "%");
const lines = [];
lines.push(`Threshold ${threshold}. ${files.length} fixtures, ${requests} requests, ${tokens.toLocaleString()} input tokens, USD ${((tokens / 1e6) * 0.042).toFixed(4)}.`);
lines.push("");
lines.push("| Rule | TP | FP | FN | Precision | Recall | Misses |");
lines.push("|---|---|---|---|---|---|---|");
for (const row of rows) {
  const misses = [...row.fps.map((x) => "FP " + x), ...row.fns.map((x) => "FN " + x)].join("; ");
  lines.push(`| ${row.r} | ${row.tp} | ${row.fp} | ${row.fn} | ${fmt(row.precision)} | ${fmt(row.recall)} | ${misses} |`);
}
lines.push("");
lines.push("Rules that never fired on any fixture and were never expected are the silent majority; they are listed under 'Silent rules' below.");
const silent = [];
const all = [];
for (const set of ["docs", "writing"]) {
  const doc = JSON.parse(readFileSync(join(HERE, "rules", `${set}.json`), "utf8"));
  for (const rule of doc.rules) all.push(`${set}/${rule.id}`);
}
for (const k of all) if (!rules.has(k)) silent.push(k);
lines.push("");
lines.push(`Silent rules (${silent.length}): ${silent.join(", ")}`);
console.log(lines.join("\n"));
