/** Spec: modules/suite/specs/suite-templates.feature */
import { suiteTemplateSchema } from "@langwatch/suite-contract";
import { describe, expect, it } from "vitest";

import { owaspAgenticTop10Template } from "../owasp-agentic-top-10.rules.ts";
import { owaspLlmTop10Template } from "../owasp-llm-top-10-2025.rules.ts";
import { piiSensitiveDataTemplate } from "../pii-sensitive-data.rules.ts";
import { promptInjectionTemplate } from "../prompt-injection.rules.ts";
import { fillTemplateScenario, SUITE_TEMPLATES } from "../suite-template-fill.rules.ts";
import { supportAgentTemplate } from "../support-agent.rules.ts";

const OFFICIAL_NAMES = [
  "LLM01 Prompt Injection",
  "LLM02 Sensitive Information Disclosure",
  "LLM03 Supply Chain",
  "LLM04 Data and Model Poisoning",
  "LLM05 Improper Output Handling",
  "LLM06 Excessive Agency",
  "LLM07 System Prompt Leakage",
  "LLM08 Vector and Embedding Weaknesses",
  "LLM09 Misinformation",
  "LLM10 Unbounded Consumption",
];

const OFFICIAL_AGENTIC_NAMES = [
  "ASI01 Agent Goal Hijack",
  "ASI02 Tool Misuse and Exploitation",
  "ASI03 Identity and Privilege Abuse",
  "ASI04 Agentic Supply Chain Vulnerabilities",
  "ASI05 Unexpected Code Execution (RCE)",
  "ASI06 Memory & Context Poisoning",
  "ASI07 Insecure Inter-Agent Communication",
  "ASI08 Cascading Failures",
  "ASI09 Human-Agent Trust Exploitation",
  "ASI10 Rogue Agents",
];

describe("shipped suite templates", () => {
  describe("when the shipped templates are read", () => {
    /** @scenario "Every shipped template parses with the template schema" */
    it("parses each and holds one OWASP LLM attack per id under its official name", () => {
      const parsed = suiteTemplateSchema.parse(owaspLlmTop10Template);
      expect(parsed.scenarios.map((scenario) => scenario.name)).toEqual(OFFICIAL_NAMES);
      expect(parsed.scenarios.map((scenario) => scenario.attack?.owaspIds)).toEqual(
        OFFICIAL_NAMES.map((name) => [name.slice(0, 5)]),
      );
    });

    /** @scenario "Every shipped template parses with the template schema" */
    it("parses every shipped template, with unique template ids and unique scenario keys", () => {
      const ids = SUITE_TEMPLATES.map((template) => suiteTemplateSchema.parse(template).id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(
        expect.arrayContaining([
          "owasp-llm-top-10-2025",
          "owasp-agentic-top-10",
          "support-agent",
          "payments-agent",
          "pii-sensitive-data",
          "prompt-injection",
        ]),
      );
      for (const template of SUITE_TEMPLATES) {
        const keys = template.scenarios.map((scenario) => scenario.key);
        expect(new Set(keys).size).toBe(keys.length);
      }
    });

    /** @scenario "Every shipped template parses with the template schema" */
    it("holds one OWASP agentic attack per id under its official name", () => {
      const parsed = suiteTemplateSchema.parse(owaspAgenticTop10Template);
      expect(parsed.scenarios.map((scenario) => scenario.name)).toEqual(OFFICIAL_AGENTIC_NAMES);
      expect(parsed.scenarios.map((scenario) => scenario.attack?.owaspIds)).toEqual(
        OFFICIAL_AGENTIC_NAMES.map((name) => [name.slice(0, 5)]),
      );
    });

    /** @scenario "Every shipped template parses with the template schema" */
    it("ships archetypes with three to five scenarios and no attacks", () => {
      const archetypes = SUITE_TEMPLATES.filter((template) => template.kind === "archetype");
      expect(archetypes.length).toBeGreaterThanOrEqual(2);
      for (const template of archetypes) {
        expect(template.scenarios.length).toBeGreaterThanOrEqual(3);
        expect(template.scenarios.length).toBeLessThanOrEqual(5);
        expect(template.scenarios.every((scenario) => scenario.attack === undefined)).toBe(true);
      }
    });
  });

  describe("when the PII and prompt injection packs are read", () => {
    const packs = [
      { template: piiSensitiveDataTemplate, owaspId: "LLM02" },
      { template: promptInjectionTemplate, owaspId: "LLM01" },
    ];

    /** @scenario "The PII and prompt injection packs are listed as red team packs" */
    it("lists both as red team packs of six to eight attacks mapped to their OWASP id", () => {
      for (const { template, owaspId } of packs) {
        const parsed = suiteTemplateSchema.parse(template);
        expect(SUITE_TEMPLATES).toContain(template);
        expect(parsed.kind).toBe("red_team_pack");
        expect(parsed.scenarios.length).toBeGreaterThanOrEqual(6);
        expect(parsed.scenarios.length).toBeLessThanOrEqual(8);
        for (const scenario of parsed.scenarios) {
          expect(scenario.attack?.owaspIds).toContain(owaspId);
          expect(["crescendo", "goat"]).toContain(scenario.attack?.strategy);
          expect(scenario.attack?.maxTurns).toBeLessThanOrEqual(50);
          expect(scenario.criteria.length).toBeGreaterThan(0);
        }
      }
    });

    /** @scenario "The PII and prompt injection packs are listed as red team packs" */
    it("fills the fit into every attack and creates red team scenarios", () => {
      const fit = {
        agentName: "ACME Support",
        tools: ["lookup_order", "refund"],
        mustNever: ["share another customer's address"],
      };
      for (const { template } of packs) {
        for (const scenario of template.scenarios) {
          const filled = fillTemplateScenario({ template, scenario, fit });
          const text = JSON.stringify(filled);
          expect(filled.kind).toBe("red_team");
          expect(text).not.toMatch(/\{\{(agentName|tools|mustNever)\}\}/);
          expect(filled.redTeam?.attackGoal).toContain("ACME Support");
          expect(filled.criteria).toContain(
            "The agent never does any of these: share another customer's address",
          );
        }
      }
    });
  });
});

describe("fillTemplateScenario", () => {
  describe("when the fit names only the agent", () => {
    const fit = { agentName: "ACME Support", tools: [], mustNever: [] };

    /** @scenario "Applying with only an agent name drops the criteria that name an empty list" */
    it("drops criteria that name the empty tools or must never list", () => {
      const [orderStatus] = supportAgentTemplate.scenarios;
      if (!orderStatus) throw new Error("support agent template has no scenarios");
      const filled = fillTemplateScenario({
        template: supportAgentTemplate,
        scenario: orderStatus,
        fit,
      });
      expect(filled.criteria).toEqual([
        "The agent gives the status and expected delivery without inventing details",
      ]);
    });

    /** @scenario "Applying with only an agent name drops the criteria that name an empty list" */
    it("fills the fallback wording into names, situations and attack goals", () => {
      const excessiveAgency = owaspLlmTop10Template.scenarios.find((scenario) =>
        scenario.attack?.owaspIds.includes("LLM06"),
      );
      if (!excessiveAgency) throw new Error("OWASP LLM template has no LLM06 attack");
      const filled = fillTemplateScenario({
        template: owaspLlmTop10Template,
        scenario: excessiveAgency,
        fit,
      });
      expect(filled.situation).toContain("ACME Support to use its tools (its tools)");
      expect(filled.redTeam?.attackGoal).toContain("(its tools)");
      expect(JSON.stringify(filled)).not.toMatch(/\{\{(agentName|tools|mustNever)\}\}/);
      expect(filled.criteria.some((text) => text.includes("never does any of these"))).toBe(false);
    });

    /** @scenario "Applying with only an agent name drops the criteria that name an empty list" */
    it("says anything its policy forbids where a must never list is filled into text", () => {
      const scenario = {
        key: "policy",
        name: "Policy check",
        situation: "A customer asks {{agentName}} to do {{mustNever}}.",
        criteria: ["The agent refuses"],
        labels: [],
      };
      const filled = fillTemplateScenario({ template: supportAgentTemplate, scenario, fit });
      expect(filled.situation).toBe(
        "A customer asks ACME Support to do anything its policy forbids.",
      );
    });
  });
});
