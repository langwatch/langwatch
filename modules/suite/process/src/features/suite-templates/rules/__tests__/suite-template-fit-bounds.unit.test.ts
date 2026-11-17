/** Spec: modules/suite/specs/suite-templates.feature */
import { redTeamConfigSchema } from "@langwatch/scenario-contract";
import { suiteTemplateFitSchema } from "@langwatch/suite-contract";
import { describe, expect, it } from "vitest";

import { fillTemplateScenario, SUITE_TEMPLATES } from "../suite-template-fill.rules.ts";

const largestFit = suiteTemplateFitSchema.parse({
  agentName: "A".repeat(120),
  tools: Array.from({ length: 50 }, (_, index) => `${index}`.padEnd(120, "t")),
  mustNever: Array.from({ length: 50 }, () => "m".repeat(500)),
});

describe("given the largest fit the schema allows", () => {
  /** @scenario The largest fit keeps every attack goal under its cap */
  it("keeps every attack goal of every template valid", () => {
    for (const template of SUITE_TEMPLATES) {
      for (const scenario of template.scenarios) {
        const filled = fillTemplateScenario({ template, scenario, fit: largestFit });
        if (!filled.redTeam) continue;
        expect(redTeamConfigSchema.validate(filled.redTeam), `${template.id}/${scenario.key}`).toBe(
          true,
        );
      }
    }
  });

  it("names how many tools it left out of a long list", () => {
    const template = SUITE_TEMPLATES.find((candidate) => candidate.id === "owasp-agentic-top-10");
    const scenario = template?.scenarios.find((candidate) => candidate.key === "asi02");
    if (!template || !scenario) throw new Error("the agentic pack has an ASI02 attack");
    const filled = fillTemplateScenario({ template, scenario, fit: largestFit });
    expect(filled.redTeam?.attackGoal).toMatch(/ and \d+ more/);
  });
});

describe("given the OWASP packs", () => {
  /** @scenario An attack that needs more than a chat says what it needs */
  it("names what the memory, peer agent, planted result and retrieval attacks need", () => {
    const needing = ["asi06", "asi07", "asi08", "llm04", "llm08"];
    const scenarios = SUITE_TEMPLATES.flatMap((template) => template.scenarios);
    for (const key of needing) {
      const scenario = scenarios.find((candidate) => candidate.key === key);
      expect(scenario?.situation, key).toMatch(/ Needs: .+\.$/);
    }
    const consumption = scenarios.find((candidate) => candidate.key === "llm10");
    expect(consumption?.criteria.join(" ")).toMatch(/1,000 words/);
  });
});
