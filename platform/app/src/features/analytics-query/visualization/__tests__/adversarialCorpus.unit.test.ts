/**
 * The adversarial corpus: every fixture must be refused, and refused by the
 * rejection path it was written to attack.
 *
 * "Refused" alone would be satisfied by a validator that refused everything, so
 * the corpus also asserts the rule each fixture claims — and the valid corpus in
 * the same run proves the validator still admits working charts.
 *
 * Node environment on purpose — see `validateVegaLiteSpec.unit.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { ADVERSARIAL_VEGA_FIXTURES } from "../../__tests__/fixtures/adversarial";
import { INVALID_VEGA_FIXTURES } from "../../__tests__/fixtures/invalid";
import {
  LWQL_FIXTURE_COLUMNS,
  LWQL_FIXTURE_ROW_COUNTS,
} from "../../__tests__/fixtures/lwqlDatasetRegistry";
import { VALID_VEGA_FIXTURES } from "../../__tests__/fixtures/valid";
import { validateVegaLiteSpec } from "../validateVegaLiteSpec";

const validate = (spec: unknown) =>
  validateVegaLiteSpec({
    spec,
    columnsByDataset: LWQL_FIXTURE_COLUMNS,
    rowCountsByDataset: LWQL_FIXTURE_ROW_COUNTS,
  });

interface FixtureOutcome {
  readonly name: string;
  readonly refused: boolean;
  /** Every error carries a code, a JSON pointer, and a message. */
  readonly structured: boolean;
  readonly namedTheExpectedRule: boolean;
}

/**
 * Reduces one fixture to the three things the corpus claims about it. Assertions
 * stay in the test body: what the loops produce is data, so a failure names
 * every offending fixture at once instead of stopping at the first.
 */
const summarize = ({
  name,
  expectedRule,
  spec,
}: {
  name: string;
  expectedRule: string;
  spec: unknown;
}): FixtureOutcome => {
  const result = validate(spec);
  const errors = result.ok ? [] : result.errors;
  return {
    name,
    refused: !result.ok,
    structured:
      errors.length > 0 &&
      errors.every(
        (error) =>
          Boolean(error.code) &&
          error.path.startsWith("/") &&
          error.message.length > 0,
      ),
    namedTheExpectedRule: errors.some((error) => error.rule === expectedRule),
  };
};

/** The names of the fixtures that failed a claim, for a readable failure. */
const namesFailing = (
  outcomes: readonly FixtureOutcome[],
  holds: (outcome: FixtureOutcome) => boolean,
): string[] => outcomes.filter((o) => !holds(o)).map((o) => o.name);

describe("the LangWatchQL Vega-Lite fixture corpus", () => {
  describe("given fixtures for every rejection path", () => {
    describe("when each fixture is validated", () => {
      /** @scenario "The adversarial corpus is refused" */
      it("refuses every one with a structured error naming the path it attacks", () => {
        expect(ADVERSARIAL_VEGA_FIXTURES.length).toBeGreaterThan(20);

        const outcomes = ADVERSARIAL_VEGA_FIXTURES.map(
          ({ name, attacks, spec }) =>
            summarize({ name, expectedRule: attacks, spec }),
        );

        expect(namesFailing(outcomes, (o) => o.refused)).toEqual([]);
        expect(namesFailing(outcomes, (o) => o.structured)).toEqual([]);
        expect(namesFailing(outcomes, (o) => o.namedTheExpectedRule)).toEqual(
          [],
        );
      });

      it("refuses the mistaken specs by the rule each of them names", () => {
        const outcomes = INVALID_VEGA_FIXTURES.map(
          ({ name, refusedBy, spec }) =>
            summarize({ name, expectedRule: refusedBy, spec }),
        );

        expect(namesFailing(outcomes, (o) => o.refused)).toEqual([]);
        expect(namesFailing(outcomes, (o) => o.namedTheExpectedRule)).toEqual(
          [],
        );
      });

      it("still admits every working chart in the valid corpus", () => {
        const refused = VALID_VEGA_FIXTURES.map(({ name, spec }) => {
          const result = validate(spec);
          return result.ok
            ? null
            : `${name}: ${result.errors.map((e) => `${e.rule}@${e.path}`).join(", ")}`;
        }).filter((entry) => entry !== null);

        expect(refused).toEqual([]);
      });
    });
  });
});
