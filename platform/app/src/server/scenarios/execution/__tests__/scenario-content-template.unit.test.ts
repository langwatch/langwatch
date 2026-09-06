/**
 * Unit tests for rendering a scenario's own situation and criteria against the
 * run's resolved parameters.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 */

import { describe, expect, it } from "vitest";

import { renderScenarioContent } from "../scenario-content-template";

describe("renderScenarioContent", () => {
  describe("given a scenario that declares no parameters", () => {
    describe("when the run supplies no values either", () => {
      /** @scenario "A scenario without parameters renders byte-identical to its stored text" */
      it("hands back the stored text byte for byte", async () => {
        const situation =
          "The customer writes {{ this }} and {% that %} in their ticket, plus a lone { brace.";
        const criteria = [
          "The agent quotes {{ this }} back verbatim",
          "The agent never expands {% that %}",
        ];

        const result = await renderScenarioContent({
          situation,
          criteria,
          parameters: {},
        });

        expect(result).toEqual({ ok: true, situation, criteria });
      });

      /** @scenario "A scenario without parameters renders byte-identical to its stored text" */
      it("leaves text the template engine would reject untouched", async () => {
        const situation = "An unclosed {% if %} tag, written on purpose";

        const result = await renderScenarioContent({
          situation,
          criteria: [],
          parameters: {},
        });

        expect(result).toEqual({ ok: true, situation, criteria: [] });
      });
    });
  });

  describe("given a scenario that reads params in its text", () => {
    describe("when every referenced name resolves", () => {
      it("fills the value into the situation and every criterion", async () => {
        const result = await renderScenarioContent({
          situation: "The customer is on the {{ params.account_tier }} plan",
          criteria: [
            "The agent mentions {{ params.account_tier }} support hours",
            "The agent stays in {{ params.region }}",
          ],
          parameters: { account_tier: "platinum", region: "eu-central" },
        });

        expect(result).toEqual({
          ok: true,
          situation: "The customer is on the platinum plan",
          criteria: [
            "The agent mentions platinum support hours",
            "The agent stays in eu-central",
          ],
        });
      });

      it("renders a numeric and a boolean value the same way", async () => {
        const result = await renderScenarioContent({
          situation:
            "Retries: {{ params.retries }}, verbose: {{ params.verbose }}",
          criteria: [],
          parameters: { retries: 3, verbose: false },
        });

        expect(result).toEqual({
          ok: true,
          situation: "Retries: 3, verbose: false",
          criteria: [],
        });
      });
    });

    describe("when a referenced name resolves to nothing", () => {
      /** @scenario "A params reference with no resolved value fails the run request with scenario_parameter_missing" */
      it("fails naming the missing name and the situation", async () => {
        const result = await renderScenarioContent({
          situation: "The customer is on the {{ params.account_tier }} plan",
          criteria: [],
          parameters: {},
          declaredNames: ["account_tier"],
        });

        expect(result).toEqual({
          ok: false,
          reason: "missing_parameters",
          field: "situation",
          names: ["account_tier"],
        });
      });

      /** @scenario "A params reference with no resolved value fails the run request with scenario_parameter_missing" */
      it("fails naming the criterion that read it, by position", async () => {
        const result = await renderScenarioContent({
          situation: "The customer is on the {{ params.account_tier }} plan",
          criteria: [
            "The agent greets the customer",
            "The agent stays in {{ params.region }}",
          ],
          parameters: { account_tier: "platinum" },
        });

        expect(result).toEqual({
          ok: false,
          reason: "missing_parameters",
          field: "criteria[1]",
          names: ["region"],
        });
      });
    });

    describe("when the text is written to exhaust the render limits", () => {
      /** @scenario "A hostile template is stopped by the render limits" */
      it("fails naming the field instead of running the loop out", async () => {
        const started = Date.now();

        const result = await renderScenarioContent({
          situation: "{% for i in (1..100000000) %}x{% endfor %}",
          criteria: [],
          parameters: { region: "eu-central" },
        });

        expect(result).toMatchObject({
          ok: false,
          reason: "template_invalid",
          field: "situation",
        });
        expect(Date.now() - started).toBeLessThan(4000);
      }, 10_000);

      /** @scenario "A hostile template is stopped by the render limits" */
      it("fails naming the criterion whose text cannot be parsed", async () => {
        const result = await renderScenarioContent({
          situation: "The customer is in {{ params.region }}",
          criteria: ["The agent {% if %} answers"],
          parameters: { region: "eu-central" },
        });

        expect(result).toMatchObject({
          ok: false,
          reason: "template_invalid",
          field: "criteria[0]",
        });
      });
    });
  });
});
