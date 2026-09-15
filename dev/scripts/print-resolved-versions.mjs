#!/usr/bin/env node
// Prints "importer, dependency, resolved version" per external dependency,
// read from pnpm-lock.yaml. Diff before/after a catalogs migration — any
// change is a bug. `workspace:`/`link:` entries are skipped.
//
// Usage: node dev/scripts/print-resolved-versions.mjs [path/to/pnpm-lock.yaml]

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const lockfilePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(here, "../../pnpm-lock.yaml");

const DEP_TYPES = new Set(["dependencies", "devDependencies"]);

// Strip a YAML scalar's surrounding quotes, unescaping doubled single quotes
// (the only escape pnpm's writer uses for a name/value that needs quoting).
function unquote(raw) {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed[0] === "'" && trimmed.at(-1) === "'") {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed.at(-1) === '"') {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// Strip a resolved `version`'s peer-suffix, e.g. `8.1.2(@types/node@26.2.0)`.
function bareVersion(version) {
  const parenIndex = version.indexOf("(");
  return parenIndex === -1 ? version : version.slice(0, parenIndex);
}

function isWorkspaceRef(specifier, version) {
  return (
    specifier.startsWith("workspace:") ||
    version.startsWith("link:") ||
    version.startsWith("workspace:")
  );
}

/** One `importers:` line, classified by what it introduces. */
function classifyLine(line) {
  const importerMatch = line.match(/^  (\S.*):$/);
  if (importerMatch) return { kind: "importer", value: unquote(importerMatch[1]) };

  const depTypeMatch = line.match(/^    (\S+):$/);
  if (depTypeMatch) return { kind: "depType", value: depTypeMatch[1] };

  const depNameMatch = line.match(/^      (\S.*):$/);
  if (depNameMatch) return { kind: "depName", value: unquote(depNameMatch[1]) };

  const fieldMatch = line.match(/^        (specifier|version): (.*)$/);
  if (fieldMatch) return { kind: "field", field: fieldMatch[1], value: unquote(fieldMatch[2]) };

  return { kind: "other" };
}

/**
 * @param {string} text
 * @returns {Array<{ importer: string, dependency: string, resolved: string }>}
 */
function parseImporters(text) {
  const rows = [];
  let inImporters = false;
  const cursor = { importer: null, inDepBlock: false, dep: null, specifier: null };

  for (const line of text.split("\n")) {
    if (line === "importers:") {
      inImporters = true;
      continue;
    }
    if (!inImporters) continue;
    if (/^[A-Za-z]/.test(line)) break; // next top-level key ends the block

    const token = classifyLine(line);
    if (token.kind === "importer") {
      cursor.importer = token.value;
      cursor.inDepBlock = false;
      cursor.dep = null;
    } else if (token.kind === "depType") {
      cursor.inDepBlock = DEP_TYPES.has(token.value);
      cursor.dep = null;
    } else if (token.kind === "depName" && cursor.inDepBlock && cursor.importer !== null) {
      cursor.dep = token.value;
      cursor.specifier = null;
    } else if (token.kind === "field" && cursor.dep !== null) {
      recordField({ token, cursor, rows });
    }
  }

  return rows;
}

function recordField({ token, cursor, rows }) {
  if (token.field === "specifier") {
    cursor.specifier = token.value;
    return;
  }
  if (cursor.specifier === null) return;
  if (!isWorkspaceRef(cursor.specifier, token.value)) {
    rows.push({
      importer: cursor.importer,
      dependency: cursor.dep,
      resolved: bareVersion(token.value),
    });
  }
  cursor.dep = null;
  cursor.specifier = null;
}

function main() {
  const text = readFileSync(lockfilePath, "utf8");
  const rows = parseImporters(text);
  rows.sort((a, b) =>
    a.importer === b.importer
      ? a.dependency.localeCompare(b.dependency)
      : a.importer.localeCompare(b.importer),
  );
  for (const { importer, dependency, resolved } of rows) {
    console.log(`${importer}, ${dependency}, ${resolved}`);
  }
}

main();
