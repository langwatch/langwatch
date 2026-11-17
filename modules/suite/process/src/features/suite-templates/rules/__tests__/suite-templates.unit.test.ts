/** Spec: modules/suite/specs/suite-templates.feature */
import { suiteTemplateSchema } from "@langwatch/suite-contract";
import { describe, expect, it } from "vitest";

import { owaspLlmTop10Template } from "../owasp-llm-top-10-2025.rules.ts";

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
  });
});
