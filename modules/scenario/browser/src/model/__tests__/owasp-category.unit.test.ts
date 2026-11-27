import { describe, expect, it } from "vitest";

import { owaspCategoryLabel, owaspCategoryName, owaspLabelRepeatsName } from "../owasp-category.ts";

describe("owaspCategoryName", () => {
  /** @scenario "The preview names each OWASP category by its official name" */
  it("names every LLM Top 10 2025 and Agentic Top 10 id", () => {
    expect(owaspCategoryName({ id: "LLM01" })).toBe("Prompt Injection");
    expect(owaspCategoryName({ id: "LLM07" })).toBe("System Prompt Leakage");
    expect(owaspCategoryName({ id: "LLM10" })).toBe("Unbounded Consumption");
    expect(owaspCategoryName({ id: "ASI01" })).toBe("Agent Goal Hijack");
    expect(owaspCategoryName({ id: "ASI10" })).toBe("Rogue Agents");
    for (let index = 1; index <= 10; index++) {
      const suffix = String(index).padStart(2, "0");
      expect(owaspCategoryName({ id: `LLM${suffix}` })).toBeDefined();
      expect(owaspCategoryName({ id: `ASI${suffix}` })).toBeDefined();
    }
  });

  it("reads the year-qualified form", () => {
    expect(owaspCategoryName({ id: "LLM02:2025" })).toBe("Sensitive Information Disclosure");
  });

  it("leaves an unknown id unnamed", () => {
    expect(owaspCategoryName({ id: "LLM11" })).toBeUndefined();
    expect(owaspCategoryLabel({ id: "LLM11" })).toBe("LLM11");
  });

  it("labels a known id with its name", () => {
    expect(owaspCategoryLabel({ id: "LLM07" })).toBe("LLM07 System Prompt Leakage");
  });

  it("treats a label as repeating a name with the same official title", () => {
    expect(
      owaspLabelRepeatsName({ id: "ASI05", name: "ASI05 Unexpected Code Execution (RCE)" }),
    ).toBe(true);
    expect(owaspLabelRepeatsName({ id: "ASI06", name: "ASI06 Memory & Context Poisoning" })).toBe(
      true,
    );
    expect(owaspLabelRepeatsName({ id: "LLM07", name: "LLM07 Leak the system prompt" })).toBe(
      false,
    );
  });
});
