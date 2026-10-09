/**
 * Writes the usage report dictionary page into docs/, or checks it.
 *
 *   pnpm exec tsx scripts/generate-usage-report-dictionary.ts          write
 *   pnpm exec tsx scripts/generate-usage-report-dictionary.ts --check  exit 1 when stale
 *
 * Run through `bash docs/scripts/generate-usage-report-dictionary.sh` from the
 * repo root, which is what docs-ci does before it diffs the generated files.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  renderUsageReportDictionaryPage,
  USAGE_REPORT_DICTIONARY_DOC_PATH,
} from "../src/server/usage-report/dictionaryDocs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const target = path.join(repoRoot, USAGE_REPORT_DICTIONARY_DOC_PATH);
const rendered = renderUsageReportDictionaryPage();

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // A missing page is stale.
  }
  if (current !== rendered) {
    console.error(
      `${USAGE_REPORT_DICTIONARY_DOC_PATH} is stale. Run: bash docs/scripts/generate-usage-report-dictionary.sh`,
    );
    process.exit(1);
  }
  console.log(`${USAGE_REPORT_DICTIONARY_DOC_PATH} is current.`);
} else {
  writeFileSync(target, rendered);
  console.log(`wrote ${USAGE_REPORT_DICTIONARY_DOC_PATH}`);
}
