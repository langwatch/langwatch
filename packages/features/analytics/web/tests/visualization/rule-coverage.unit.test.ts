/**
 * The guard that makes a new LangWatchQL rule impossible to add without a test.
 *
 * A rule is covered either by an adversarial or invalid fixture that declares
 * it — and `adversarial-corpus.unit.test.ts` proves each fixture really is
 * refused by the rule it declares — or by a named test file, which must contain
 * the rule identifier for the claim to count. A map entry pointing at a file
 * that never mentions the rule fails here rather than reading as coverage.
 *
 * Node environment on purpose — see `validate-vega-lite-spec.unit.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ADVERSARIAL_VEGA_FIXTURES } from "../fixtures/adversarial";
import { INVALID_VEGA_FIXTURES } from "../fixtures/invalid";
import { LWQL_VEGA_RULES } from "../../src/visualization/vega-lite-policy";
import {
  type LangWatchQLVegaRuleId,
  LWQL_VEGA_RULE_IDS,
  VEGA_VALIDATION_ERROR_CODES,
} from "../../src/visualization/visualization-types";

const TEST_DIR = fileURLToPath(new URL("./", import.meta.url));

/**
 * Rules whose refusal has no fixture, because the thing they refuse cannot be
 * a checked-in `.json` file: text that is not JSON, a value that is not an
 * object, a specification too large to be worth committing, a row count, or a
 * runtime load. Each names the test that exercises it.
 */
const RULES_COVERED_BY_NAMED_TESTS: Partial<Record<LangWatchQLVegaRuleId, string>> = {
  "spec.not-json": "validate-vega-lite-spec.unit.test.ts",
  "spec.not-object": "validate-vega-lite-spec.unit.test.ts",
  "limit.maxSpecBytes": "vega-lite-limits.unit.test.ts",
  "limit.maxRowsPerDataset": "vega-lite-limits.unit.test.ts",
  "limit.maxRowsAllDatasets": "vega-lite-limits.unit.test.ts",
  "loader.blocked": "no-network-vega-loader.unit.test.ts",
  // Raised by the chart layer rather than by validation: there is no
  // specification that "is" a Vega runtime failure or an all-empty result.
  "render.failure": "lwql-chart-failures.unit.test.ts",
  "encoding.empty": "lwql-chart-failures.unit.test.ts",
};

describe("LangWatchQL rule coverage", () => {
  describe("given the exported policy rule list", () => {
    describe("when it is compared with the tests and fixtures", () => {
      it("covers every rule by a fixture that declares it or a test that names it", () => {
        const byFixture = new Set<string>([
          ...ADVERSARIAL_VEGA_FIXTURES.map((fixture) => fixture.attacks),
          ...INVALID_VEGA_FIXTURES.map((fixture) => fixture.refusedBy),
        ]);

        const byNamedTest = new Set<string>();
        for (const [rule, file] of Object.entries(RULES_COVERED_BY_NAMED_TESTS)) {
          const source = readFileSync(join(TEST_DIR, file), "utf8");
          expect(source.includes(rule), `${file} must name ${rule} to cover it`).toBe(
            true,
          );
          byNamedTest.add(rule);
        }

        const uncovered = LWQL_VEGA_RULES.map((rule) => rule.id).filter(
          (id) => !byFixture.has(id) && !byNamedTest.has(id),
        );

        expect(
          uncovered,
          "every LangWatchQL rule needs a fixture or a named test",
        ).toEqual([]);
      });

      it("keeps the rule list, the identifier list, and the catalogue in step", () => {
        expect(LWQL_VEGA_RULES.map((rule) => rule.id)).toEqual([...LWQL_VEGA_RULE_IDS]);

        for (const rule of LWQL_VEGA_RULES) {
          expect(
            VEGA_VALIDATION_ERROR_CODES,
            `${rule.id} must map to a known code`,
          ).toContain(rule.code);
          expect(rule.summary.length, `${rule.id} needs a summary`).toBeGreaterThan(0);
        }
      });

      it("claims coverage only for rules that exist", () => {
        for (const rule of Object.keys(RULES_COVERED_BY_NAMED_TESTS)) {
          expect(LWQL_VEGA_RULE_IDS).toContain(rule);
        }
        for (const fixture of ADVERSARIAL_VEGA_FIXTURES) {
          expect(LWQL_VEGA_RULE_IDS).toContain(fixture.attacks);
        }
        for (const fixture of INVALID_VEGA_FIXTURES) {
          expect(LWQL_VEGA_RULE_IDS).toContain(fixture.refusedBy);
        }
      });
    });
  });
});
