import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isOverengineeringSource,
  overengineeringFindings,
} from "../../grammar/overengineering.mjs";

// The one pass the three over-abstraction rules share. Each rule used to ask
// the detectors for its own policy, so every `.ts` file was analysed three
// times; the findings are now computed once per program and read three times.
//
// The memo is keyed by the Program node itself, so it cannot go stale: a new
// parse is a new node, and a freed one takes its entry with it.

const findingsByProgram = new WeakMap();

const baselineCache = new Map();

/** The sites that already fired when these policies landed, as `policy|file`. */
function baselineSites(cwd) {
  const cached = baselineCache.get(cwd);
  if (cached) return cached;

  const file = join(cwd, "packages", "architecture-lint", "src", "overengineering-baseline.json");
  let sites = new Set();
  if (existsSync(file)) {
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      if (Array.isArray(value.sites)) sites = new Set(value.sites);
    } catch {
      sites = new Set();
    }
  }
  baselineCache.set(cwd, sites);

  return sites;
}

/** Only the over-abstraction sources: no declarations, tests or generated code. */
export function isOverengineeringFile(file) {
  return !file.workspacePath.startsWith("../") && isOverengineeringSource(file.workspacePath);
}

/**
 * The findings of one policy for the file under the cursor, baseline applied.
 *
 * @param {object} context The oxlint rule context.
 * @param {import("../classify.mjs").FileClassification} file
 * @param {string} policy
 * @param {object} program The `Program` node the rule's visitor was handed.
 */
export function reportsFor(context, file, policy, program) {
  let findings = findingsByProgram.get(program);
  if (!findings) {
    findings = overengineeringFindings({
      path: file.filename,
      program,
      text: context.sourceCode.text,
    });
    findingsByProgram.set(program, findings);
  }
  if (baselineSites(context.cwd).has(`${policy}|${file.workspacePath}`)) return [];

  return findings.filter((finding) => finding.policy === policy);
}

/** Drops the baseline memo. Only the fixture harness needs this. */
export function resetOverengineeringBaselineCache() {
  baselineCache.clear();
}
