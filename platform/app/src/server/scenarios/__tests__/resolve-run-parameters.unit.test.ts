/**
 * @vitest-environment node
 *
 * What a run resolves before anything is scheduled, and what it refuses.
 *
 * The secret half is the point of most of these: a secret value must never
 * reach the plain record, the scenario text, or any error message.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 * @see specs/scenarios/secret-run-parameters.feature
 */

import { describe, expect, it } from "vitest";

import type { RunParameterValues } from "../parameters";
import { resolveRunParameters } from "../resolve-run-parameters";
import type { ScenarioRunConfig } from "../scenario.repository";

const SECRET_VALUE = "tok-live-abc123";

function scenario(
  overrides: Partial<ScenarioRunConfig> = {},
): ScenarioRunConfig {
  return {
    id: "scen_1",
    name: "Refund flow",
    situation: "A customer asks for a refund",
    version: 1,
    criteria: ["Answers the question"],
    parameters: null,
    ...overrides,
  };
}

function resolve(params: {
  scenarios: ScenarioRunConfig[];
  values?: RunParameterValues;
}) {
  return resolveRunParameters(params);
}

describe("resolveRunParameters", () => {
  describe("given a scenario declaring a secret parameter", () => {
    const declaring = scenario({
      parameters: [
        { name: "api_token", secret: true },
        { name: "region", defaultValue: "eu-central" },
      ],
    });

    describe("when the run supplies its value", () => {
      it("keeps the value out of the plain record and returns it as a secret", async () => {
        const resolved = await resolve({
          scenarios: [declaring],
          values: { api_token: SECRET_VALUE },
        });

        expect(resolved.get("scen_1")?.parameters).toEqual({
          region: "eu-central",
        });
        expect(resolved.get("scen_1")?.secretParameters).toEqual({
          api_token: SECRET_VALUE,
        });
      });
    });

    describe("when the run supplies no value for it", () => {
      /** @scenario "A secret parameter value must be supplied when the run starts" */
      it("rejects the run naming the parameter", async () => {
        await expect(resolve({ scenarios: [declaring] })).rejects.toMatchObject(
          {
            code: "scenario_secret_parameter_missing",
            meta: { names: ["api_token"] },
          },
        );
      });

      /** @scenario "Error messages never contain a secret value" */
      it("rejects a value that is not text the same way", async () => {
        await expect(
          resolve({ scenarios: [declaring], values: { api_token: 42 } }),
        ).rejects.toMatchObject({
          code: "scenario_secret_parameter_missing",
        });
      });

      // The run dialog cannot send an empty field, but a caller that goes
      // straight to the API can, and a credential of no length is not one.
      /** @scenario "A secret parameter value must be supplied when the run starts" */
      it("rejects an empty value the same way", async () => {
        await expect(
          resolve({ scenarios: [declaring], values: { api_token: "" } }),
        ).rejects.toMatchObject({
          code: "scenario_secret_parameter_missing",
          meta: { names: ["api_token"] },
        });
      });
    });

    describe("when the rejection is read back", () => {
      /** @scenario "Error messages never contain a secret value" */
      it("names the parameter without carrying any value", async () => {
        const scenarios = [
          scenario({
            situation: "A {{ params.api_token }} customer asks for a refund",
            parameters: [{ name: "api_token", secret: true }],
          }),
        ];

        const error = await resolve({
          scenarios,
          values: { api_token: SECRET_VALUE },
        }).catch((thrown: unknown) => thrown);

        expect(JSON.stringify(error)).not.toContain(SECRET_VALUE);
        expect((error as Error).message).not.toContain(SECRET_VALUE);
        expect((error as Error).message).toContain("api_token");
      });
    });
  });

  describe("given a scenario whose own text reads a secret parameter", () => {
    describe("when the run is started", () => {
      /** @scenario "Scenario text cannot read a secret parameter" */
      it("rejects the run with the dedicated error", async () => {
        await expect(
          resolve({
            scenarios: [
              scenario({
                situation: "Use {{ params.api_token }} to call the API",
                parameters: [{ name: "api_token", secret: true }],
              }),
            ],
            values: { api_token: SECRET_VALUE },
          }),
        ).rejects.toMatchObject({
          code: "scenario_secret_parameter_in_text",
          meta: { names: ["api_token"], field: "situation" },
        });
      });

      /** @scenario "Scenario text cannot read a secret parameter" */
      it("names the criterion that reads it", async () => {
        await expect(
          resolve({
            scenarios: [
              scenario({
                criteria: ["Answers", "Sends {{ params.api_token }}"],
                parameters: [{ name: "api_token", secret: true }],
              }),
            ],
            values: { api_token: SECRET_VALUE },
          }),
        ).rejects.toMatchObject({
          code: "scenario_secret_parameter_in_text",
          meta: { field: "criteria[1]" },
        });
      });
    });

    describe("when the missing name is a plain one", () => {
      it("still reports it as a plain missing name", async () => {
        await expect(
          resolve({
            scenarios: [
              scenario({
                situation: "A {{ params.account_tier }} customer",
                parameters: [{ name: "account_tier" }],
              }),
            ],
          }),
        ).rejects.toMatchObject({ code: "scenario_parameter_missing" });
      });
    });
  });

  describe("given two scenarios in one run declaring the same name", () => {
    describe("when one calls it secret and the other plain", () => {
      /** @scenario "A name declared secret in one scenario and plain in another rejects the run" */
      it("rejects the run", async () => {
        await expect(
          resolve({
            scenarios: [
              scenario({
                id: "scen_secret",
                parameters: [{ name: "api_token", secret: true }],
              }),
              scenario({
                id: "scen_plain",
                parameters: [{ name: "api_token", defaultValue: "public" }],
              }),
            ],
            values: { api_token: SECRET_VALUE },
          }),
        ).rejects.toMatchObject({
          code: "scenario_secret_parameter_conflict",
          meta: { names: ["api_token"] },
        });
      });
    });

    describe("when only one scenario declares it secret", () => {
      it("resolves the secret only for the scenario that declares it", async () => {
        const resolved = await resolve({
          scenarios: [
            scenario({
              id: "scen_secret",
              parameters: [{ name: "api_token", secret: true }],
            }),
            scenario({ id: "scen_none", parameters: [] }),
          ],
          values: { api_token: SECRET_VALUE },
        });

        expect(resolved.get("scen_secret")?.secretParameters).toEqual({
          api_token: SECRET_VALUE,
        });
        expect(resolved.get("scen_none")?.secretParameters).toEqual({});
        expect(resolved.get("scen_none")?.parameters).toEqual({});
      });
    });
  });

  describe("given a run supplying a name no scenario declares", () => {
    describe("when the run is started", () => {
      it("still rejects with the unknown-name error", async () => {
        await expect(
          resolve({
            scenarios: [scenario({ parameters: [{ name: "region" }] })],
            values: { regoin: "us-east" },
          }),
        ).rejects.toMatchObject({ code: "scenario_parameter_unknown" });
      });
    });
  });
});
