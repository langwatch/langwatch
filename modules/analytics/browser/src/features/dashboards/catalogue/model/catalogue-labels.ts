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
  changed: "Did it change? (vs yesterday or the last version)",
  line: "Is it past a limit?",
  compare: "How do A and B compare?",
  why: "Why did it happen?",
  matters: "What matters most?",
  prove: "Can I show or prove it?",
};

export const TRUNKS = ["Profit", "Growth", "Protect", "Foundation"] as const;
export type Trunk = (typeof TRUNKS)[number];

/** Whether a widget reads one project or the whole org. */
export type CatalogueScope = "project" | "org";
