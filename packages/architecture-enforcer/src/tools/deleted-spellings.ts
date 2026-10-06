import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  countDeletedSpellingsInCode,
  DELETED_SPELLINGS_RATCHET,
  lintDeletedSpellingsInTeaching,
} from "../policies/quality/deleted-spellings.ts";
import { buildWorkspaceSnapshot } from "../workspace/snapshot.ts";

/**
 * Prints where the deleted spellings stand: teaching findings per file (the reseed work queue)
 * and code counts per spelling against the shrink-only list. `--lower` writes each code count
 * down to today's and refuses when any count rose. Record: dev/docs/ARCHITECTURE.md §15, §17.
 */

const RECORD =
  "dev/docs/ARCHITECTURE.md §15, deleted spellings: each spelling's count in code (Alex, plan dev/docs/plans/architecture-teaching-2026-10-05.md step 2). Shrink-only: lower a count in the change that removes a use (node --experimental-transform-types packages/architecture-enforcer/src/tools/deleted-spellings.ts --lower).";

const ratchetFile = z.object({
  record: z.string(),
  findings: z.record(z.string(), z.number().int().positive()),
});

function tally(keys: readonly string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);

  return [...counts].toSorted(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
}

function lower({
  file,
  current,
}: {
  file: string;
  current: ReadonlyMap<string, number>;
}): string[] {
  const listed = existsSync(file)
    ? ratchetFile.parse(JSON.parse(readFileSync(file, "utf8")))
    : undefined;
  const grown = [...current]
    .filter(([key, count]) => listed !== undefined && count > (listed.findings[key] ?? 0))
    .map(([key, count]) => `${key}: ${count} found, ${listed?.findings[key] ?? 0} listed`);
  if (grown.length > 0) return grown;

  const findings = Object.fromEntries(
    [...current].toSorted(([left], [right]) => left.localeCompare(right)),
  );
  writeFileSync(file, `${JSON.stringify({ record: RECORD, findings }, null, 2)}\n`, "utf8");

  return [];
}

function main(argv: readonly string[]): number {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const snapshot = buildWorkspaceSnapshot({ root, changedFiles: [] });
  const teaching = lintDeletedSpellingsInTeaching(snapshot);
  const code = countDeletedSpellingsInCode(snapshot);

  console.log(`teaching surfaces: ${teaching.length} findings`);
  for (const [file, count] of tally(teaching.map((finding) => finding.file)))
    console.log(`  ${String(count).padStart(4)}  ${file}`);
  console.log("teaching findings by spelling:");
  for (const [spelling, count] of tally(teaching.map((finding) => finding.specifier ?? "")))
    console.log(`  ${String(count).padStart(4)}  ${spelling}`);
  console.log(
    `code: ${[...code.values()].reduce((sum, count) => sum + count, 0)} uses of ${code.size} spellings`,
  );
  for (const [spelling, count] of [...code].toSorted((left, right) => right[1] - left[1]))
    console.log(`  ${String(count).padStart(4)}  ${spelling}`);

  if (!argv.includes("--lower")) return 0;

  const grown = lower({ file: join(root, DELETED_SPELLINGS_RATCHET), current: code });
  if (grown.length === 0) {
    console.log(`wrote ${DELETED_SPELLINGS_RATCHET}`);
    return 0;
  }
  console.error(
    `refused: these counts rose, so remove the new uses first:\n  ${grown.join("\n  ")}`,
  );

  return 1;
}

process.exitCode = main(process.argv.slice(2));
