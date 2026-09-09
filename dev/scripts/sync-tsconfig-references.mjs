#!/usr/bin/env node
// Generates every tsconfig `references` array from the pnpm workspace manifests,
// so no one types a project reference again. `--check` (the default) reports the
// files that would change and exits 1; `--write` rewrites them in place. The
// derivation rules live in the module this imports; `--scripts` additionally
// checks that each package's `typecheck` script spells no path of its own.
import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  deriveWorkspaceReferences,
  readWorkspaceMembers,
  renderReferences,
} from "../../packages/architecture-lint/src/workspace/tsconfig-references.ts";

const options = process.argv.slice(2);
const rootIndex = options.indexOf("--root");
const root = resolve(rootIndex === -1 ? process.cwd() : options[rootIndex + 1]);
const write = options.includes("--write");
const scripts = options.includes("--scripts");

function unifiedDiff(path, before, after) {
  const left = before.split("\n");
  const right = after.split("\n");
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1;

  let end = 0;
  while (
    end < left.length - start &&
    end < right.length - start &&
    left[left.length - 1 - end] === right[right.length - 1 - end]
  ) {
    end += 1;
  }
  const removed = left.slice(start, left.length - end);
  const added = right.slice(start, right.length - end);
  lines.push(`@@ -${start + 1},${removed.length} +${start + 1},${added.length} @@`);
  for (const line of removed) lines.push(`-${line}`);
  for (const line of added) lines.push(`+${line}`);

  return lines.join("\n");
}

/** The path-free form: `.` is the package's own tsconfig.json, resolved from INIT_CWD. */
function pathFreeScript(line, directory) {
  return line.replace(/(--project|-p)\s+(\S+)/, (match, flag, project) => {
    const target = relative(directory, resolve(root, project));
    if (target.startsWith("..")) return match;

    return `${flag} ${target === "tsconfig.json" ? "." : `./${target}`}`;
  });
}

function checkScripts(members) {
  const drifted = [];
  for (const member of members) {
    const manifestPath = resolve(member.directory, "package.json");
    const text = readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(text);
    const line = manifest.scripts?.typecheck;
    if (typeof line !== "string" || !line.includes("typecheck:declarations")) continue;

    const wanted = pathFreeScript(line, member.directory);
    if (wanted === line) continue;

    drifted.push({ file: relative(root, manifestPath), line, wanted });
    if (write) {
      manifest.scripts.typecheck = wanted;
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }

  return drifted;
}

const projects = deriveWorkspaceReferences(root);
const changed = [];
const undeducible = [];
for (const project of projects) {
  const path = relative(root, project.file);
  const before = readFileSync(project.file, "utf8");
  const after = renderReferences(before, project.references);
  for (const entry of project.undeducible) undeducible.push({ path, entry });
  if (before === after) continue;

  changed.push({ path, before, after });
  if (write) writeFileSync(project.file, after);
}

const driftedScripts = scripts ? checkScripts(readWorkspaceMembers(root)) : [];
if (write) {
  console.log(`Wrote ${changed.length} of ${projects.length} tsconfig files.`);
} else {
  for (const { path, before, after } of changed)
    console.log(`${unifiedDiff(path, before, after)}\n`);
  for (const { file, line, wanted } of driftedScripts) {
    console.log(`${file}\n-  ${line}\n+  ${wanted}\n`);
  }
}
for (const { path, entry } of undeducible) {
  console.log(
    `Undeducible reference in ${path}: ${entry}. Keep it under langwatchExtraReferences.`,
  );
}
console.log(
  `${changed.length} of ${projects.length} tsconfig files differ; ${undeducible.length} undeducible entries; ${driftedScripts.length} typecheck scripts spell a path.`,
);
if (!write && (changed.length > 0 || undeducible.length > 0 || driftedScripts.length > 0)) {
  process.exitCode = 1;
}
