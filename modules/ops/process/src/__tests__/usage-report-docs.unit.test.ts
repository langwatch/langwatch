/**
 * The docs page is the dictionary, rendered. A dictionary change that did not
 * regenerate the page fails here before it reaches a customer.
 * Spec: specs/self-hosting/connected-services/usage-report.feature
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  escapeTableCell,
  renderUsageReportDictionaryPage,
  USAGE_FIELDS,
  USAGE_NEVER_COLLECTED,
  USAGE_REPORT_DICTIONARY_DOC_PATH,
  USAGE_REPORT_SCHEMA_VERSION,
} from "@langwatch/ops-contract";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..", "..", "..");

describe("the usage report dictionary page", () => {
  describe("when the dictionary is rendered", () => {
    /** @scenario "The docs page lists every field the dictionary declares" */
    it("names every field, its window, its reason, and the never-collected list", () => {
      const page = renderUsageReportDictionaryPage();

      for (const field of USAGE_FIELDS) {
        expect(page).toContain(`\`${field.key}\``);
        expect(page).toContain(escapeTableCell(field.why));
      }
      for (const item of USAGE_NEVER_COLLECTED) {
        expect(page).toContain(`- ${item}`);
      }
      expect(page).toContain(`schema version ${USAGE_REPORT_SCHEMA_VERSION}`);
      expect(page).toContain("(own switch)");
      expect(page).not.toContain("—");
    });
  });

  describe("when the committed page is compared with the dictionary", () => {
    /** @scenario "The docs page fails the build when it is stale" */
    it("matches byte for byte, or names the command that regenerates it", () => {
      const committed = readFileSync(path.join(repoRoot, USAGE_REPORT_DICTIONARY_DOC_PATH), "utf8");
      expect(
        committed,
        `${USAGE_REPORT_DICTIONARY_DOC_PATH} is stale. Run: bash docs/scripts/generate-usage-report-dictionary.sh`,
      ).toBe(renderUsageReportDictionaryPage());
    });
  });
});
