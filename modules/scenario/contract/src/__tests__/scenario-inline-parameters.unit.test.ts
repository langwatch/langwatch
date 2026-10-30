/**
 * @vitest-environment node
 * Inline `{ key: value }` run parameter declarations in a scenario's situation.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 */

import { describe, expect, it } from "vitest";

import { resolveRunParameters } from "../features/run/run-parameters.ts";
import { renderScenarioContent } from "../scenario-content-template.ts";
import {
  declaredScenarioParameters,
  extractInlineRunParameters,
} from "../scenario-inline-parameters.ts";
import type { ScenarioRunConfig } from "../scenario.ts";

function scenario(overrides: Partial<ScenarioRunConfig> = {}): ScenarioRunConfig {
  return {
    id: "scen_1",
    name: "Late order",
    version: 1,
    situation: "A customer asks about a late order",
    criteria: ["Answers the question"],
    parameters: null,
    ...overrides,
  };
}

/** What the simulated user is briefed with, through the same seam the run uses. */
async function situationHandedOn({
  config,
  values,
}: {
  config: ScenarioRunConfig;
  values?: Record<string, string>;
}): Promise<{ situation: string; parameters: Record<string, unknown> }> {
  const resolved = await resolveRunParameters({ scenarios: [config], values });
  const parameters = resolved.get(config.id)!.parameters;
  const { definitions, situation } = declaredScenarioParameters({
    parameters: config.parameters,
    situation: config.situation,
  });
  const rendered = await renderScenarioContent({
    situation,
    criteria: config.criteria,
    parameters,
    declaredNames: definitions.map((definition) => definition.name),
  });
  if (!rendered.ok) throw new Error(`render failed: ${rendered.reason}`);
  return { situation: rendered.situation, parameters };
}

describe("extractInlineRunParameters", () => {
  describe("given one declaration", () => {
    /** @scenario "An inline declaration in the situation declares a parameter with its default" */
    it("declares the name with its default and leaves a params reference in its place", () => {
      const result = extractInlineRunParameters({
        text: "The customer is { tone: frustrated } about a late order",
      });

      expect(result).toEqual({
        template: "The customer is {{ params.tone }} about a late order",
        definitions: [{ name: "tone", defaultValue: "frustrated" }],
      });
    });

    /** @scenario "Inline declarations and params references work in one situation" */
    it("hands Liquid a template that no longer holds the declaration", () => {
      const { template } = extractInlineRunParameters({
        text: "A { tone: frustrated } customer in {{ params.region }}",
      });

      expect(template).not.toContain("tone:");
      expect(template).toBe("A {{ params.tone }} customer in {{ params.region }}");
    });
  });

  describe("given several declarations", () => {
    /** @scenario "Several inline declarations, a value with spaces among them" */
    it("declares each, keeping spaces inside a value and trimming around it", () => {
      const result = extractInlineRunParameters({
        text: "A {tier:   gold plan  } customer in { region: eu-central }",
      });

      expect(result.definitions).toEqual([
        { name: "tier", defaultValue: "gold plan" },
        { name: "region", defaultValue: "eu-central" },
      ]);
      expect(result.template).toBe("A {{ params.tier }} customer in {{ params.region }}");
    });

    /** @scenario "The same name declared inline twice keeps the first default" */
    it("keeps the first default when a name is declared twice", () => {
      const result = extractInlineRunParameters({
        text: "{ tone: calm } at first, still { tone: angry } later",
      });

      expect(result.definitions).toEqual([{ name: "tone", defaultValue: "calm" }]);
      expect(result.template).toBe("{{ params.tone }} at first, still {{ params.tone }} later");
    });
  });

  describe("given braces that are not a declaration", () => {
    /** @scenario "A brace that is not an inline declaration stays as text" */
    it.each([
      ["empty braces", "Reply with {} when unsure"],
      ["no colon", "Mention { no colon } verbatim"],
      ["an empty value", "Leave { key: } alone"],
      ["JSON", 'The ticket body is {"order_id": "123", "status": "late"}'],
      ["a name outside the grammar", "Read { 9lives: cat } as text"],
      ["a reserved name", "Read { constructor: x } as text"],
      ["a value across lines", "Keep { note: one\ntwo } as text"],
    ])("leaves %s as written", (_, text) => {
      expect(extractInlineRunParameters({ text })).toEqual({ template: text, definitions: [] });
    });

    /** @scenario "A declaration inside double braces is left to Liquid" */
    it("leaves a declaration inside double braces to Liquid", () => {
      const text = "The customer is {{ tone: calm }}";

      expect(extractInlineRunParameters({ text })).toEqual({ template: text, definitions: [] });
    });
  });
});

describe("declaredScenarioParameters", () => {
  describe("given a stored declaration with the same name as an inline one", () => {
    /** @scenario "A name the scenario already declares keeps its stored declaration" */
    it("keeps the stored declaration and adds only the new inline names", () => {
      const result = declaredScenarioParameters({
        parameters: [{ name: "tone", defaultValue: "calm" }],
        situation: "The customer is { tone: angry } in { region: eu-central }",
      });

      expect(result.definitions).toEqual([
        { name: "tone", defaultValue: "calm" },
        { name: "region", defaultValue: "eu-central" },
      ]);
      expect(result.situation).toBe("The customer is {{ params.tone }} in {{ params.region }}");
    });
  });
});

describe("a run of a scenario with inline declarations", () => {
  describe("when the run supplies no value", () => {
    /** @scenario "An inline declaration in the situation declares a parameter with its default" */
    it("resolves the default and briefs the simulated user with it", async () => {
      const result = await situationHandedOn({
        config: scenario({ situation: "The customer is { tone: frustrated } about a late order" }),
      });

      expect(result).toEqual({
        parameters: { tone: "frustrated" },
        situation: "The customer is frustrated about a late order",
      });
    });

    /** @scenario "Several inline declarations, a value with spaces among them" */
    it("resolves every declaration", async () => {
      const result = await situationHandedOn({
        config: scenario({ situation: "A { tier: gold plan } customer in { region: eu-central }" }),
      });

      expect(result).toEqual({
        parameters: { tier: "gold plan", region: "eu-central" },
        situation: "A gold plan customer in eu-central",
      });
    });

    /** @scenario "The same name declared inline twice keeps the first default" */
    it("shows the one resolved value in both places", async () => {
      const result = await situationHandedOn({
        config: scenario({ situation: "{ tone: calm } at first, still { tone: angry } later" }),
      });

      expect(result.situation).toBe("calm at first, still calm later");
    });

    /** @scenario "A name the scenario already declares keeps its stored declaration" */
    it("resolves the stored default over the inline one", async () => {
      const result = await situationHandedOn({
        config: scenario({
          parameters: [{ name: "tone", defaultValue: "calm" }],
          situation: "The customer is { tone: angry }",
        }),
      });

      expect(result.parameters).toEqual({ tone: "calm" });
    });
  });

  describe("when the run supplies a value for the inline name", () => {
    /** @scenario "A run-time value wins over an inline default" */
    it("accepts the name as declared and shows the supplied value", async () => {
      const result = await situationHandedOn({
        config: scenario({ situation: "The customer is { tone: frustrated }" }),
        values: { tone: "calm" },
      });

      expect(result).toEqual({
        parameters: { tone: "calm" },
        situation: "The customer is calm",
      });
    });
  });

  describe("when the situation also reads a stored parameter", () => {
    /** @scenario "Inline declarations and params references work in one situation" */
    it("renders both", async () => {
      const result = await situationHandedOn({
        config: scenario({
          parameters: [{ name: "region", defaultValue: "eu-central" }],
          situation: "A { tone: frustrated } customer in {{ params.region }}",
        }),
      });

      expect(result.situation).toBe("A frustrated customer in eu-central");
    });
  });

  describe("when the situation holds braces that are not declarations", () => {
    /** @scenario "A brace that is not an inline declaration stays as text" */
    it("hands them on as written beside a real declaration", async () => {
      const result = await situationHandedOn({
        config: scenario({
          situation: 'Body {"order_id": "123"}, {}, { no colon }, { key: } and { tone: calm }',
        }),
      });

      expect(result.situation).toBe(
        'Body {"order_id": "123"}, {}, { no colon }, { key: } and calm',
      );
    });
  });

  describe("when the inline name is a stored secret", () => {
    /** @scenario "An inline declaration naming a secret parameter is refused" */
    it("refuses the run as a secret read in the text", async () => {
      await expect(
        resolveRunParameters({
          scenarios: [
            scenario({
              parameters: [{ name: "api_token", secret: true }],
              situation: "Use { api_token: abc123 } to sign in",
            }),
          ],
          values: { api_token: "tok-live-xyz" },
        }),
      ).rejects.toMatchObject({ code: "scenario_secret_parameter_in_text" });
    });
  });
});
