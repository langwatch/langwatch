/**
 * The design-system rollout codemod over every browser source the census reads:
 * `node .storybook/codemod/codemod.ts --transform <name> [--dry-run | --write]
 * [--report <path>] [files...]`. A transform is one module under `transforms/` + a line below.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { browserSources } from "../census.ts";
import { type FileOutcome, type Transform, applyEdits } from "./ast.ts";
import { drawerGroundTransform } from "./transforms/drawer-ground.ts";
import { opsConfirmDialogTransform } from "./transforms/ops-confirm-dialog.ts";
import { overlayCosmeticsTransform } from "./transforms/overlay-cosmetics.ts";
import { pixelSpacingTransform } from "./transforms/pixel-spacing.ts";
import { plainConfirmTransform } from "./transforms/plain-confirm.ts";
import { simpleDialogTransform } from "./transforms/simple-dialog.ts";
import { simpleDrawerTransform } from "./transforms/simple-drawer.ts";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
export const TRANSFORMS: Transform[] = [
  pixelSpacingTransform,
  opsConfirmDialogTransform,
  overlayCosmeticsTransform,
  drawerGroundTransform,
  simpleDrawerTransform,
  simpleDialogTransform,
  plainConfirmTransform,
];

export type FileRun = FileOutcome & { file: string };

export function runTransform({
  transform,
  files,
  read,
}: {
  transform: Transform;
  files: string[];
  read: ({ file }: { file: string }) => string;
}): FileRun[] {
  return files
    .map((file) => ({ file, ...transform.run({ file, source: read({ file }) }) }))
    .filter((run) => run.changes.length || run.skips.length);
}

/** The dry-run report: per-file changes, then the skips grouped by reason. */
export function renderReport({ transform, runs }: { transform: Transform; runs: FileRun[] }) {
  const changed = runs.filter((run) => run.edits.length);
  const skips = runs.flatMap((run) => run.skips.map((skip) => ({ ...skip, file: run.file })));
  const changeCount = changed.reduce((sum, run) => sum + run.changes.length, 0);
  const out = [`# Codemod \`${transform.name}\``, "", transform.summary, ""];
  out.push(`${changeCount} changes in ${changed.length} files; ${skips.length} sites skipped.`, "");
  out.push("## Changes", "");
  for (const run of changed) {
    out.push(`### ${run.file}`, "");
    for (const change of run.changes) {
      out.push(`- ${change.line}: \`${change.before}\` -> \`${change.after}\``);
    }
    out.push("");
  }
  const reasons = new Map<string, typeof skips>();
  for (const skip of skips) reasons.set(skip.reason, [...(reasons.get(skip.reason) ?? []), skip]);
  out.push("## Skipped", "", "| Count | Reason |", "| ---: | --- |");
  const ranked = [...reasons].toSorted((a, b) => b[1].length - a[1].length);
  for (const [reason, list] of ranked) out.push(`| ${list.length} | ${reason} |`);
  out.push("");
  for (const [reason, list] of ranked) {
    out.push(`### ${reason} (${list.length})`, "");
    for (const skip of list) out.push(`- ${skip.file}:${skip.line} \`${skip.snippet}\``);
    out.push("");
  }
  return `${out.join("\n")}\n`;
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      transform: { type: "string" },
      "dry-run": { type: "boolean" },
      write: { type: "boolean" },
      report: { type: "string" },
    },
  });
  const transform = TRANSFORMS.find((entry) => entry.name === values.transform);
  if (!transform) {
    const names = TRANSFORMS.map((entry) => entry.name).join(", ");
    throw new Error(`--transform <name> is required; one of: ${names}`);
  }
  const files = positionals.length ? positionals : browserSources();
  const read = ({ file }: { file: string }) => readFileSync(path.join(ROOT, file), "utf8");
  const runs = runTransform({ transform, files, read });
  const report = renderReport({ transform, runs });
  if (values.report) writeFileSync(path.resolve(values.report), report);
  else process.stdout.write(report);
  if (!values.write) return;
  for (const run of runs.filter((entry) => entry.edits.length)) {
    const source = read({ file: run.file });
    writeFileSync(path.join(ROOT, run.file), applyEdits({ source, edits: run.edits }));
    process.stderr.write(`${run.file}\n`);
  }
}

if (import.meta.main) main();
