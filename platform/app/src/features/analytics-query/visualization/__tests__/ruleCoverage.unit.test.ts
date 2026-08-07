/**
 * The guard that makes a new governed rule impossible to add without a test.
 *
 * A rule is covered either by an adversarial or invalid fixture that declares
 * it — and `adversarialCorpus.unit.test.ts` proves each fixture really is
 * refused by the rule it declares — or by a named test file, which must contain
 * the rule identifier for the claim to count. A map entry pointing at a file
 * that never mentions the rule fails here rather than reading as coverage.
 *
 * Node environment on purpose — see `validateVegaLiteSpec.unit.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ADVERSARIAL_VEGA_FIXTURES } from "../../__tests__/fixtures/adversarial";
import { INVALID_VEGA_FIXTURES } from "../../__tests__/fixtures/invalid";
import { GOVERNED_VEGA_RULES } from "../vegaLitePolicy";
import {
  GOVERNED_VEGA_RULE_IDS,
  type GovernedVegaRuleId,
  VEGA_VALIDATION_ERROR_CODES,
} from "../visualization.types";

const TEST_DIR = fileURLToPath(new URL("./", import.meta.url));

/**
 * Rules whose refusal has no fixture, because the thing they refuse cannot be
 * a checked-in `.json` file: text that is not JSON, a value that is not an
 * object, a specification too large to be worth committing, a row count, or a
 * runtime load. Each names the test that exercises it.
 */
const RULES_COVERED_BY_NAMED_TESTS: Partial<
  Record<GovernedVegaRuleId, string>
> = {
  "spec.not-json": "validateVegaLiteSpec.unit.test.ts",
  "spec.not-object": "validateVegaLiteSpec.unit.test.ts",
  "limit.maxSpecBytes": "vegaLiteLimits.unit.test.ts",
  "limit.maxRowsPerDataset": "vegaLiteLimits.unit.test.ts",
  "limit.maxRowsAllDatasets": "vegaLiteLimits.unit.test.ts",
  "loader.blocked": "noNetworkVegaLoader.unit.test.ts",
  // Raised by the chart layer rather than by validation: there is no
  // specification that "is" a Vega runtime failure or an all-empty result.
  "render.failure": "governedChartFailures.unit.test.ts",
  "encoding.empty": "governedChartFailures.unit.test.ts",
};

describe("governed rule coverage", () => {
  describe("given the exported policy rule list", () => {
    describe("when it is compared with the tests and fixtures", () => {
      it("covers every rule by a fixture that declares it or a test that names it", () => {
        const byFixture = new Set<string>([
          ...ADVERSARIAL_VEGA_FIXTURES.map((fixture) => fixture.attacks),
          ...INVALID_VEGA_FIXTURES.map((fixture) => fixture.refusedBy),
        ]);

        const byNamedTest = new Set<string>();
        for (const [rule, file] of Object.entries(
          RULES_COVERED_BY_NAMED_TESTS,
        )) {
          const source = readFileSync(join(TEST_DIR, file), "utf8");
          expect(
            source.includes(rule),
            `${file} must name ${rule} to cover it`,
          ).toBe(true);
          byNamedTest.add(rule);
        }

        const uncovered = GOVERNED_VEGA_RULES.map((rule) => rule.id).filter(
          (id) => !byFixture.has(id) && !byNamedTest.has(id),
        );

        expect(
          uncovered,
          "every governed rule needs a fixture or a named test",
        ).toEqual([]);
      });

      it("keeps the rule list, the identifier list, and the catalogue in step", () => {
        expect(GOVERNED_VEGA_RULES.map((rule) => rule.id)).toEqual([
          ...GOVERNED_VEGA_RULE_IDS,
        ]);

        for (const rule of GOVERNED_VEGA_RULES) {
          expect(
            VEGA_VALIDATION_ERROR_CODES,
            `${rule.id} must map to a known code`,
          ).toContain(rule.code);
          expect(
            rule.summary.length,
            `${rule.id} needs a summary`,
          ).toBeGreaterThan(0);
        }
      });

      it("claims coverage only for rules that exist", () => {
        for (const rule of Object.keys(RULES_COVERED_BY_NAMED_TESTS)) {
          expect(GOVERNED_VEGA_RULE_IDS as readonly string[]).toContain(rule);
        }
        for (const fixture of ADVERSARIAL_VEGA_FIXTURES) {
          expect(GOVERNED_VEGA_RULE_IDS as readonly string[]).toContain(
            fixture.attacks,
          );
        }
      });
    });
  });
});
