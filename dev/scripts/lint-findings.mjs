#!/usr/bin/env node
/**
 * Prints each oxlint finding beside the code it names, so a lane reads findings in one call.
 * Why: specs/tooling/lint-findings-with-code.feature
 *   node dev/scripts/lint-findings.mjs <list.txt | files…> [--rule a,b] [--context 4] [--max 40]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function ruleName({ code }) {
  return code.replace(/^([\w-]+)\((.+)\)$/, "$1/$2");
}

export function toFindings({ diagnostics, rules }) {
  return diagnostics
    .map((d) => ({
      file: d.filename,
      line: d.labels?.[0]?.span?.line ?? 1,
      rule: ruleName({ code: d.code }),
      message: d.message,
    }))
    .filter(
      (f) => rules.length === 0 || rules.some((r) => f.rule === r || f.rule.endsWith(`/${r}`)),
    )
    .toSorted((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function summarise({ findings }) {
  const counts = new Map();
  for (const f of findings) counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
  const files = new Set(findings.map((f) => f.file)).size;
  const perRule = [...counts].toSorted((a, b) => b[1] - a[1]).map(([rule, n]) => `${rule} ${n}`);
  return `${findings.length} findings in ${files} files: ${perRule.join(", ") || "none"}`;
}

export function excerptRanges({ lines, context }) {
  const ranges = [];
  for (const line of lines.toSorted((a, b) => a - b)) {
    const from = Math.max(1, line - context);
    const last = ranges.at(-1);
    if (last && from <= last.to + 1) last.to = Math.max(last.to, line + context);
    else ranges.push({ from, to: line + context });
  }
  return ranges;
}

function renderExcerpt({ source, range, marked }) {
  const out = [];
  for (let n = range.from; n <= Math.min(range.to, source.length); n++) {
    out.push(`${marked.has(n) ? ">" : " "}${String(n).padStart(5)}│ ${source[n - 1]}`);
  }
  return out;
}

function renderFile({ file, findings, readSource, context }) {
  const out = [`== ${file} (${findings.length})`];
  for (const f of findings) out.push(`  L${f.line} ${f.rule}: ${f.message}`);
  const source = readSource({ file });
  const lines = findings.map((f) => f.line);
  for (const range of excerptRanges({ lines, context })) {
    out.push(...renderExcerpt({ source, range, marked: new Set(lines) }), "");
  }
  return out;
}

export function renderFindings({ findings, readSource, context, max }) {
  const shown = findings.slice(0, max);
  const byFile = Map.groupBy(shown, (f) => f.file);
  const out = [summarise({ findings })];
  for (const [file, fileFindings] of byFile)
    out.push(...renderFile({ file, findings: fileFindings, readSource, context }));
  if (findings.length > shown.length) {
    out.push(
      `… ${findings.length - shown.length} more findings not shown; fix these, narrow with --rule, or raise --max.`,
    );
  }
  return out.join("\n");
}

export function parseArgs({ argv }) {
  const options = { targets: [], rules: [], context: 4, max: 40 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--rule") options.rules = argv[++i].split(",");
    else if (arg === "--context") options.context = Number(argv[++i]);
    else if (arg === "--max") options.max = Number(argv[++i]);
    else options.targets.push(arg);
  }
  return options;
}

function listFiles({ targets }) {
  const files = targets.flatMap((t) =>
    t.endsWith(".txt")
      ? readFileSync(t, "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
      : [t],
  );
  return files.filter((f) => existsSync(f));
}

function runOxlint({ files }) {
  const args = [
    "exec",
    "oxlint",
    "--quiet",
    "--type-aware",
    "--config",
    ".oxlintrc.jsonc",
    "-f",
    "json",
    ...files,
  ];
  try {
    return JSON.parse(
      execFileSync("pnpm", args, {
        encoding: "utf8",
        maxBuffer: 1 << 28,
        stdio: ["ignore", "pipe", "inherit"],
      }),
    );
  } catch (error) {
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

function main() {
  const options = parseArgs({ argv: process.argv.slice(2) });
  const files = listFiles({ targets: options.targets });
  if (files.length === 0) {
    console.error(
      "lint-findings: no existing files in the arguments; refusing to lint the whole tree.",
    );
    process.exit(2);
  }
  const { diagnostics } = runOxlint({ files });
  const findings = toFindings({ diagnostics, rules: options.rules });
  const readSource = ({ file }) => readFileSync(file, "utf8").split("\n");
  console.log(renderFindings({ findings, readSource, context: options.context, max: options.max }));
  process.exit(findings.length > 0 ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
