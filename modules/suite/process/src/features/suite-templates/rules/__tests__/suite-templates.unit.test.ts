/** Spec: modules/suite/specs/suite-templates.feature */
import { suiteTemplateSchema } from "@langwatch/suite-contract";
import { describe, expect, it } from "vitest";

import { owaspAgenticTop10Template } from "../owasp-agentic-top-10.rules.ts";
import { owaspLlmTop10Template } from "../owasp-llm-top-10-2025.rules.ts";
import { SUITE_TEMPLATES } from "../suite-template-fill.rules.ts";

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
  "ASI05 Unexpected Code Execution",
  "ASI06 Memory and Context Poisoning",
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
});
