/**
 * The words the catalogue labels widgets and templates with.
 * Generated from the dashboards library draft on 2026-10-06; edit here from now on.
 */

export const AGENT_KINDS = [
  "support-bot",
  "rag",
  "vendor",
  "voice",
  "extraction",
  "regulated",
  "tools-agent",
  "generative",
  "coding",
] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const AGENT_KIND_LABELS: Readonly<Record<AgentKind, string>> = {
  "support-bot": "Support bot",
  rag: "Knowledge (RAG) assistant",
  vendor: "Agent platform (many client companies)",
  voice: "Voice agent",
  extraction: "Document extraction",
  regulated: "Regulated assistant",
  "tools-agent": "Tools agent",
  generative: "Generative feature",
  coding: "Coding agent",
};

/** The finder's agent-type chips: the full names, shortened where they run long. */
export const AGENT_KIND_CHIP_LABELS: Readonly<Record<AgentKind, string>> = {
  ...AGENT_KIND_LABELS,
  vendor: "Agent platform",
};

/** How a focus template names its agent kind: "Release check: voice focus". */
export const AGENT_KIND_FOCUS_LABELS: Readonly<Record<AgentKind, string>> = {
  "support-bot": "support bot",
  rag: "RAG",
  vendor: "agent platform",
  voice: "voice",
  extraction: "extraction",
  regulated: "regulated",
  "tools-agent": "tools agent",
  generative: "generative",
  coding: "coding",
};

export const PERSONAS = [
  "eng",
  "product",
  "qa",
  "ops",
  "finance",
  "risk",
  "leader",
  "prompt",
  "expert",
] as const;
export type Persona = (typeof PERSONAS)[number];

/** Who reads the board, and what they do. */
export const PERSONA_LABELS: Readonly<
  Record<Persona, { readonly name: string; readonly does: string }>
> = {
  eng: { name: "Engineer", does: "Builds and debugs the agent" },
  product: { name: "Product owner", does: "Decides what the agent does and for whom" },
  qa: { name: "QA or evals lead", does: "Tests before release" },
  ops: { name: "Operations or CX lead", does: "Runs the agent day to day; handles hand-offs" },
  finance: { name: "Finance or FinOps", does: "Budgets, billing and chargeback" },
  risk: { name: "Risk and compliance", does: "Safety, privacy, audit" },
  leader: { name: "Business leader", does: "Funds the agent; owns the business case" },
  prompt: { name: "Prompt engineer", does: "Tunes prompts and picks models" },
  expert: { name: "Domain expert", does: "Knows the right answer; reviews what the agent says" },
};

export const QUESTION_TYPES = [
  "happened",
  "changed",
  "line",
  "compare",
  "why",
  "matters",
  "prove",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** The shape of a question; it decides the chart. */
export const QUESTION_TYPE_LABELS: Readonly<Record<QuestionType, string>> = {
  happened: "What happened?",
  changed: "Did the number change? (vs yesterday or the last version)",
  line: "Is the number past a limit?",
  compare: "How do A and B compare?",
  why: "Why did the number move?",
  matters: "What matters most?",
  prove: "Can I show or prove the result?",
};

/** The question tree's trunks: each a verb for what the member wants from their agent. */
export const TRUNKS = ["Grow", "Protect", "Profit", "Trust"] as const;
export type Trunk = (typeof TRUNKS)[number];

/** The question each trunk answers. */
export const TRUNK_QUESTIONS: Readonly<Record<Trunk, string>> = {
  Profit: "Am I spending well?",
  Grow: "Is my agent growing my business?",
  Protect: "Can my agent hurt me?",
  Trust: "Can I trust the numbers?",
};

/** What a trunk's templates are for, under its question when the finder shows one trunk. */
export const TRUNK_PITCHES: Readonly<Record<Trunk, string>> = {
  Profit:
    "See what your agent costs, where the money goes and what each result costs, so you can spend less without losing quality.",
  Grow: "See who uses your agent, what they ask and whether they come back, so you know what to build next.",
  Protect:
    "Check that answers are right, safe and working, and that a change did not break anything. Use these before and after you ship.",
  Trust:
    "Check that your traces carry what the other dashboards need. Use this when a number looks wrong.",
};

/** Whether a widget reads one project or the whole org. */
export type CatalogueScope = "project" | "org";
