/**
 * Writes the usage report dictionary page into docs/, or with `--check` exits
 * 1 when the committed page is stale. docs-ci runs it through
 * `bash docs/scripts/generate-usage-report-dictionary.sh` before diffing.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  renderUsageReportDictionaryPage,
  USAGE_REPORT_DICTIONARY_DOC_PATH,
} from "@langwatch/ops-contract";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const target = path.join(repoRoot, USAGE_REPORT_DICTIONARY_DOC_PATH);
const rendered = renderUsageReportDictionaryPage();

if (process.argv.includes("--check")) {
  if (!existsSync(target) || readFileSync(target, "utf8") !== rendered) {
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
