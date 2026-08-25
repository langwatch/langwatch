/**
 * Unit tests for scenario run parameters: what a scenario may declare, and how
 * a run's values resolve against those declarations.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 * @see specs/scenarios/secret-run-parameters.feature
 */

import { describe, expect, it } from "vitest";

import {
  findUnknownParameterKeys,
  MAX_RUN_PARAMETER_BYTES,
  MAX_RUN_PARAMETER_KEYS,
  MAX_SCENARIO_PARAMETER_DEFINITIONS,
  mergeRunParameters,
  parseScenarioParameterDefinitions,
  partitionParameterDefinitions,
  runParameterValuesSchema,
  scenarioParameterDefinitionsSchema,
  withoutParameterNames,
} from "../parameters";

const definition = (name: string, defaultValue?: string | number | boolean) => ({
  name,
  ...(defaultValue === undefined ? {} : { defaultValue }),
});

describe("scenario run parameters", () => {
  describe("given a scenario declaring a parameter with a default", () => {
    describe("when the run supplies its own value", () => {
      /** @scenario "A run-time value overrides the scenario's default value" */
      it("resolves the supplied value", () => {
        const resolved = mergeRunParameters({
          definitions: [definition("account_tier", "gold")],
          values: { account_tier: "platinum" },
        });

        expect(resolved).toEqual({ account_tier: "platinum" });
      });
    });

    describe("when the run supplies no value for it", () => {
      /** @scenario "A parameter with no run-time value falls back to its default" */
      it("resolves the declared default", () => {
        const resolved = mergeRunParameters({
          definitions: [
            definition("region", "eu-central"),
            definition("account_tier", "gold"),
          ],
          values: { account_tier: "platinum" },
        });

        expect(resolved).toEqual({
          region: "eu-central",
          account_tier: "platinum",
        });
      });

      /** @scenario "A parameter with no run-time value falls back to its default" */
      it("resolves the declared default when the run supplies nothing at all", () => {
        expect(
          mergeRunParameters({
            definitions: [definition("region", "eu-central")],
          }),
        ).toEqual({ region: "eu-central" });
      });
    });
  });

  describe("given a declaration with no default", () => {
    it("leaves the name out of the resolved values", () => {
      expect(mergeRunParameters({ definitions: [definition("region")] })).toEqual({});
    });

    it("keeps a supplied false and zero rather than treating them as absent", () => {
      const resolved = mergeRunParameters({
        definitions: [definition("verbose", true), definition("retries", 3)],
        values: { verbose: false, retries: 0 },
      });

      expect(resolved).toEqual({ verbose: false, retries: 0 });
    });
  });

  describe("given a parameter name", () => {
    describe("when it is outside the identifier grammar", () => {
      /** @scenario "A parameter name outside the identifier grammar is rejected at save time" */
      it("rejects the declaration", () => {
        for (const name of [
          "account tier",
          "account-tier",
          "1region",
          "params.region",
          "",
        ]) {
          const result = scenarioParameterDefinitionsSchema.safeParse([{ name }]);
          expect(result.success, `expected "${name}" to be rejected`).toBe(false);
        }
      });

      /** @scenario "A parameter name outside the identifier grammar is rejected at save time" */
      it("rejects a run value supplied under that name", () => {
        expect(
          runParameterValuesSchema.safeParse({ "account tier": "gold" }).success,
        ).toBe(false);
      });
    });

    describe("when it satisfies the identifier grammar", () => {
      it("accepts the declaration", () => {
        const result = scenarioParameterDefinitionsSchema.safeParse([
          { name: "_account_tier2", description: "Plan", defaultValue: "gold" },
        ]);

        expect(result.success).toBe(true);
      });
    });

    describe("when the same name is declared twice", () => {
      it("rejects the declarations", () => {
        const result = scenarioParameterDefinitionsSchema.safeParse([
          definition("region", "eu-central"),
          definition("region", "us-east"),
        ]);

        expect(result.success).toBe(false);
      });
    });
  });

  describe("given more declarations than one scenario may carry", () => {
    /** @scenario "More than twenty definitions on one scenario are rejected at save time" */
    it("rejects the save", () => {
      const tooMany = Array.from(
        { length: MAX_SCENARIO_PARAMETER_DEFINITIONS + 1 },
        (_, index) => definition(`p${index}`),
      );

      expect(scenarioParameterDefinitionsSchema.safeParse(tooMany).success).toBe(false);
      expect(
        scenarioParameterDefinitionsSchema.safeParse(tooMany.slice(0, -1)).success,
      ).toBe(true);
    });
  });

  describe("given a run-time payload over the size limits", () => {
    /** @scenario "A run-time payload over the size limits is rejected before scheduling" */
    it("rejects more names than a run may supply", () => {
      const tooManyKeys = Object.fromEntries(
        Array.from({ length: MAX_RUN_PARAMETER_KEYS + 1 }, (_, index) => [
          `p${index}`,
          "x",
        ]),
      );

      expect(runParameterValuesSchema.safeParse(tooManyKeys).success).toBe(false);
    });

    /** @scenario "A run-time payload over the size limits is rejected before scheduling" */
    it("rejects values that together exceed the byte budget", () => {
      const chunk = "x".repeat(2000);
      const tooManyBytes = Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [`p${index}`, chunk]),
      );

      expect(
        new TextEncoder().encode(JSON.stringify(tooManyBytes)).length,
      ).toBeGreaterThan(MAX_RUN_PARAMETER_BYTES);
      expect(runParameterValuesSchema.safeParse(tooManyBytes).success).toBe(false);
    });

    /** @scenario "A run-time payload over the size limits is rejected before scheduling" */
    it("rejects a single value longer than one value may be", () => {
      expect(runParameterValuesSchema.safeParse({ note: "x".repeat(4097) }).success).toBe(
        false,
      );
    });

    it("accepts a payload inside every limit", () => {
      expect(
        runParameterValuesSchema.safeParse({
          region: "eu-central",
          retries: 3,
          verbose: true,
        }).success,
      ).toBe(true);
    });
  });

  describe("given a scenario's stored parameters column", () => {
    it("reads back the declarations it holds", () => {
      expect(
        parseScenarioParameterDefinitions([
          { name: "region", defaultValue: "eu-central" },
        ]),
      ).toEqual([{ name: "region", defaultValue: "eu-central" }]);
    });

    it("reads a scenario with no declarations as none", () => {
      expect(parseScenarioParameterDefinitions(null)).toEqual([]);
      expect(parseScenarioParameterDefinitions(undefined)).toEqual([]);
      expect(parseScenarioParameterDefinitions([])).toEqual([]);
    });

    it("reads a shape it does not understand as none rather than failing the run", () => {
      expect(parseScenarioParameterDefinitions({ region: "eu-central" })).toEqual([]);
      expect(parseScenarioParameterDefinitions("region")).toEqual([]);
      expect(parseScenarioParameterDefinitions([{ label: "region" }])).toEqual([]);
    });
  });

  describe("given a name JavaScript treats as more than a key", () => {
    describe("when a scenario declares it", () => {
      it("refuses the declaration, naming what is not allowed", () => {
        for (const name of ["__proto__", "constructor", "prototype"]) {
          const parsed = scenarioParameterDefinitionsSchema.safeParse([
            definition(name, "gold"),
          ]);

          expect(parsed.success).toBe(false);
        }
      });
    });

    describe("when a run supplies a value for it", () => {
      // Parsed from JSON, the way a REST body arrives: that is what makes the
      // name an OWN key. Written as an object literal, __proto__ would reach
      // the prototype setter and never be a key at all.
      const fromJson = (name: string) =>
        JSON.parse(`{"${name}": "gold"}`) as Record<string, string>;

      it("refuses every one of them, so no name is dropped in silence", () => {
        // __proto__ is the one that needs the key schema. Zod drops that key
        // while it builds the record, so a refinement over the result would
        // see an empty record and answer success, and the caller would get a
        // 2xx for a value the run then ignored.
        for (const name of ["__proto__", "constructor", "prototype"]) {
          expect(runParameterValuesSchema.safeParse(fromJson(name)).success).toBe(false);
        }
      });
    });

    describe("when a scenario stored before the guard still carries it", () => {
      it("leaves it out of the resolved record instead of touching a prototype", () => {
        const resolved = mergeRunParameters({
          definitions: [
            definition("__proto__", "gold"),
            definition("region", "eu-central"),
          ],
        });

        expect(Object.keys(resolved)).toEqual(["region"]);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      });
    });
  });

  describe("given values supplied for a run", () => {
    describe("when a name no scenario in the run declares is among them", () => {
      it("reports that name and only that name", () => {
        expect(
          findUnknownParameterKeys({
            declaredNames: ["region", "account_tier"],
            values: { region: "eu-central", regoin: "us-east" },
          }),
        ).toEqual(["regoin"]);
      });
    });

    describe("when every name is declared by some scenario in the run", () => {
      it("reports nothing", () => {
        expect(
          findUnknownParameterKeys({
            declaredNames: ["region", "account_tier"],
            values: { region: "eu-central" },
          }),
        ).toEqual([]);
      });
    });
  });

  describe("given a parameter declared secret", () => {
    describe("when it also carries a default value", () => {
      /** @scenario "A parameter declared secret cannot carry a default value" */
      it("rejects the declaration", () => {
        const result = scenarioParameterDefinitionsSchema.safeParse([
          { name: "api_token", secret: true, defaultValue: "abc" },
        ]);

        expect(result.success).toBe(false);
      });
    });

    describe("when it carries no default value", () => {
      it("accepts the declaration", () => {
        const result = scenarioParameterDefinitionsSchema.safeParse([
          { name: "api_token", secret: true, description: "The API token" },
        ]);

        expect(result.success).toBe(true);
      });
    });

    describe("when the declarations are split for a run", () => {
      it("keeps the secret ones out of the plain half", () => {
        const { plain, secret } = partitionParameterDefinitions([
          definition("region", "eu-central"),
          { name: "api_token", secret: true },
          { name: "plain_flag", secret: false },
        ]);

        expect(plain.map((one) => one.name)).toEqual(["region", "plain_flag"]);
        expect(secret.map((one) => one.name)).toEqual(["api_token"]);
      });

      it("resolves nothing for a secret name in the plain merge", () => {
        const { plain } = partitionParameterDefinitions([
          definition("region", "eu-central"),
          { name: "api_token", secret: true },
        ]);

        const resolved = mergeRunParameters({
          definitions: plain,
          values: withoutParameterNames({
            values: { region: "us-east", api_token: "tok-live-1" },
            names: new Set(["api_token"]),
          }),
        });

        expect(resolved).toEqual({ region: "us-east" });
      });
    });
  });
});
