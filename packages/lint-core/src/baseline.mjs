import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Debt for the rules oxlint cannot express as a per-file numeric tier lives
// here instead of in the config: one `rule|file` key per exempted file, with
// a `measured` date. A rule that can read this file (a JS `defineRule`, not a
// native oxlint rule) consults it directly and reports nothing for a
// baselined file; a native rule (`max-depth`, `complexity`) still needs a
// generated config override, produced from this same file by
// `generate-native-baseline-overrides.mjs`.

const BASELINE_PATH = "packages/architecture-lint/src/oxlint-baseline.json";

const baselineCache = new Map();

/** `key` for one baseline entry: `rule|file`. */
export function baselineKey({ file, rule }) {
  return `${rule}|${file}`;
}

/**
 * Checks the baseline document's shape. Every entry needs a non-empty
 * `measured` date; an entry missing one is refused rather than silently
 * treated as baselined forever.
 *
 * @returns {string[]} One message per problem found; empty when valid.
 */
export function validateBaseline(data) {
  const errors = [];
  if (!data || typeof data !== "object" || !Array.isArray(data.entries)) {
    return ["baseline must be an object with an `entries` array"];
  }

  const seen = new Set();
  let previous;
  data.entries.forEach((entry, index) => {
    const key = entry?.key;
    if (typeof key !== "string" || !key.includes("|")) {
      errors.push(`entries[${index}]: "key" must be a "rule|file" string`);
      return;
    }

    if (typeof entry.measured !== "string" || entry.measured.trim() === "") {
      errors.push(`entries[${index}] (${key}): missing "measured"`);
    }

    if (seen.has(key)) errors.push(`entries[${index}]: duplicate key ${key}`);
    seen.add(key);

    if (previous !== undefined && !(previous < key)) {
      errors.push(`entries[${index}]: baseline must be sorted (${previous} before ${key})`);
    }
    previous = key;
  });

  return errors;
}

function loadBaselineDocument(cwd) {
  const path = join(cwd, BASELINE_PATH);
  if (!existsSync(path)) return { entries: [] };

  const raw = JSON.parse(readFileSync(path, "utf8"));
  const errors = validateBaseline(raw);
  if (errors.length > 0) {
    throw new Error(`${BASELINE_PATH} is invalid:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }

  return raw;
}

/**
 * The baseline's keys, loaded and validated once per workspace root.
 *
 * @returns {Set<string>}
 */
export function loadBaseline(cwd = process.cwd()) {
  const cached = baselineCache.get(cwd);
  if (cached) return cached;

  const document = loadBaselineDocument(cwd);
  const keys = new Set(document.entries.map((entry) => entry.key));
  baselineCache.set(cwd, keys);

  return keys;
}

/** Whether `file` (workspace-relative) is baselined for `rule`. */
export function isBaselined({ cwd = process.cwd(), file, rule }) {
  return loadBaseline(cwd).has(baselineKey({ file, rule }));
}

/** Drops the memoised baseline. Only the fixture harness needs this. */
export function resetBaselineCache() {
  baselineCache.clear();
}
