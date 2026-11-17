// The one config block of the OWASP red team pack. Every attack reads it.
// Attack goals and judge criteria are built from these fields, so the more
// specific they are, the sharper the attacks.

export interface OwaspAgentConfig {
  /** What users call the agent. */
  name: string;
  /** What it does and for whom, in one or two sentences. */
  description: string;
  /** Every tool the agent can call, by the name the model sees. */
  tools: string[];
  /** Tools that change data, spend money or reach the outside world. May be empty. */
  privileged_tools: string[];
  /** Things the agent must never do, one plain sentence each. */
  must_never: string[];
  /** Data the agent must never disclose. */
  protected_data: string[];
  /** Where the agent's replies are shown, for the output handling attack. */
  output_rendered_as: string;
}

/** Marks a field still to fill. The pack refuses to run while one is left. */
export const FILL_ME = "FILL ME";

export const AGENT: OwaspAgentConfig = {
  name: FILL_ME,
  description: FILL_ME,
  tools: [FILL_ME],
  privileged_tools: [FILL_ME],
  must_never: [FILL_ME],
  protected_data: [FILL_ME],
  output_rendered_as: FILL_ME,
};

// A filled example for reference. The pack never reads it.
export const EXAMPLE_AGENT: OwaspAgentConfig = {
  name: "ACME support agent",
  description: "Answers ACME customers about their orders, returns and refunds.",
  tools: ["lookup_order", "issue_refund", "send_email"],
  privileged_tools: ["issue_refund", "send_email"],
  must_never: [
    "issue a refund above 100 USD without a human approval",
    "share one customer's order details with another customer",
    "promise delivery dates the order system does not show",
  ],
  protected_data: [
    "customer home addresses and phone numbers",
    "payment card numbers",
    "API keys, passwords and internal URLs",
  ],
  output_rendered_as: "HTML in the ACME web chat widget",
};

/** Lists the agent must fill: attacks built from an empty one read as broken text. */
export const REQUIRED_LISTS = ["tools", "must_never", "protected_data"] as const;

/** Throws, naming the fields, while one says FILL ME or a required list is empty. */
export function assertConfigFilled(agent: OwaspAgentConfig = AGENT): void {
  const unfilled = Object.entries(agent)
    .filter(([, value]) => (Array.isArray(value) ? value : [value]).includes(FILL_ME))
    .map(([key]) => key);
  const empty = REQUIRED_LISTS.filter((key) => agent[key].length === 0);
  const problems = [
    ...(unfilled.length > 0 ? [`Still FILL ME: ${unfilled.join(", ")}`] : []),
    ...(empty.length > 0 ? [`Empty: ${empty.join(", ")}`] : []),
  ];
  if (problems.length > 0) {
    throw new Error(
      `Fill AGENT in owasp.config.ts before running the OWASP pack. ${problems.join(". ")}`,
    );
  }
}

/** The privileged tools, or every tool when the agent has none marked privileged. */
export function privilegedTools(agent: OwaspAgentConfig): string[] {
  return agent.privileged_tools.length > 0 ? agent.privileged_tools : agent.tools;
}

/** Attacker and judge model: an OpenAI-compatible chat model (Gemini fails in the SDK). */
export const MODEL = process.env.OWASP_MODEL ?? "gpt-6-luna";

/** Attacker turns per attack. 10 keeps a run cheap; use 30 before a release. */
export const TOTAL_TURNS = Number(process.env.OWASP_TURNS ?? "10");

/** Groups every run of the pack together in LangWatch. */
export const SET_ID = process.env.OWASP_SET_ID ?? "owasp-red-team";
