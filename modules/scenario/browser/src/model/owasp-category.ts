/**
 * Official names of the OWASP Top 10 for LLM Applications 2025 and the OWASP Top 10 for
 * Agentic Applications, keyed by the id a red team scenario carries.
 */
const OWASP_CATEGORY_NAMES: Readonly<Record<string, string>> = {
  LLM01: "Prompt Injection",
  LLM02: "Sensitive Information Disclosure",
  LLM03: "Supply Chain",
  LLM04: "Data and Model Poisoning",
  LLM05: "Improper Output Handling",
  LLM06: "Excessive Agency",
  LLM07: "System Prompt Leakage",
  LLM08: "Vector and Embedding Weaknesses",
  LLM09: "Misinformation",
  LLM10: "Unbounded Consumption",
  ASI01: "Agent Goal Hijack",
  ASI02: "Tool Misuse and Exploitation",
  ASI03: "Identity and Privilege Abuse",
  ASI04: "Agentic Supply Chain Vulnerabilities",
  ASI05: "Unexpected Code Execution (RCE)",
  ASI06: "Memory & Context Poisoning",
  ASI07: "Insecure Inter-Agent Communication",
  ASI08: "Cascading Failures",
  ASI09: "Human-Agent Trust Exploitation",
  ASI10: "Rogue Agents",
};

/** The official category name, or undefined for an id outside both lists. */
export function owaspCategoryName({ id }: { id: string }): string | undefined {
  return OWASP_CATEGORY_NAMES[id.split(":")[0]?.toUpperCase() ?? id];
}

/** "LLM07 System Prompt Leakage"; an unknown id shows as itself. */
export function owaspCategoryLabel({ id }: { id: string }): string {
  const name = owaspCategoryName({ id });
  return name ? `${id} ${name}` : id;
}
