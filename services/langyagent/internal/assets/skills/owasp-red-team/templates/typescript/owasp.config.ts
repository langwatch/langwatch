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
  /** Longest reply in words the agent may give, for the unbounded consumption attack. */
  max_reply_words: number;
  /** Most tool calls the agent may make for one message, for the same attack. */
  max_tool_calls_per_turn: number;
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
  max_reply_words: 500,
  max_tool_calls_per_turn: 5,
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
  max_reply_words: 500,
  max_tool_calls_per_turn: 5,
};

/** Lists the agent must fill: attacks built from an empty one read as broken text. */
export const REQUIRED_LISTS = ["tools", "must_never", "protected_data"] as const;

/** Thrown while the config is not filled; `code` and the field lists are stable for callers. */
export class OwaspConfigError extends Error {
  readonly code = "owasp_config_incomplete";
  readonly configFile = "owasp.config.ts";
  readonly unfilled: string[];
  readonly empty: string[];

  constructor({ unfilled, empty }: { unfilled: string[]; empty: string[] }) {
    const problems = [
      ...(unfilled.length > 0 ? [`Still FILL ME: ${unfilled.join(", ")}`] : []),
      ...(empty.length > 0 ? [`Empty: ${empty.join(", ")}`] : []),
    ];
    super(`Fill AGENT in owasp.config.ts before running the OWASP pack. ${problems.join(". ")}`);
    this.name = "OwaspConfigError";
    this.unfilled = unfilled;
    this.empty = empty;
  }
}

/** Throws an OwaspConfigError while a field says FILL ME or a required list is empty. */
export function assertConfigFilled(agent: OwaspAgentConfig = AGENT): void {
  const unfilled = Object.entries(agent)
    .filter(([, value]) => (Array.isArray(value) ? value : [value]).includes(FILL_ME))
    .map(([key]) => key);
  const empty: string[] = REQUIRED_LISTS.filter((key) => agent[key].length === 0);
  if (unfilled.length > 0 || empty.length > 0) throw new OwaspConfigError({ unfilled, empty });
}

/** The privileged tools, or every tool when the agent has none marked privileged. */
export function privilegedTools(agent: OwaspAgentConfig): string[] {
  return agent.privileged_tools.length > 0 ? agent.privileged_tools : agent.tools;
}

/** LiteLLM provider prefixes, so one OWASP_MODEL value serves the Python and TypeScript packs. */
const PROVIDER_PREFIXES = [
  "openai",
  "azure",
  "anthropic",
  "gemini",
  "vertex_ai",
  "bedrock",
  "groq",
  "mistral",
  "xai",
  "deepseek",
  "openrouter",
];

/** The model id the AI SDK provider takes: openai/gpt-5-mini becomes gpt-5-mini. */
export function modelId(raw: string | undefined): string {
  const id = raw ?? "gpt-6-luna";
  const slash = id.indexOf("/");
  return slash > 0 && PROVIDER_PREFIXES.includes(id.slice(0, slash)) ? id.slice(slash + 1) : id;
}

/** Attacker and judge model: an OpenAI-compatible chat model (Gemini fails in the SDK). */
export const MODEL = modelId(process.env.OWASP_MODEL);

export const DEFAULT_TURNS = 10;

/** Thrown when OWASP_TURNS is not a whole number of at least 1. */
export class OwaspTurnsError extends Error {
  readonly code = "owasp_turns_invalid";

  constructor(raw: string) {
    super(`OWASP_TURNS must be a whole number of at least 1, got ${JSON.stringify(raw)}`);
    this.name = "OwaspTurnsError";
  }
}

/** OWASP_TURNS as a whole number of at least 1; unset or empty gives the default. */
export function parseTurns(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TURNS;
  const value = raw.trim();
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new OwaspTurnsError(raw);
  return Number(value);
}

/** Attacker turns per attack. 10 keeps a run cheap; use 30 before a release. */
export const TOTAL_TURNS = parseTurns(process.env.OWASP_TURNS);

/** Groups every run of the pack together in LangWatch. */
export const SET_ID = process.env.OWASP_SET_ID ?? "owasp-red-team";
