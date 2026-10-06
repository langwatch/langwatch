/**
 * The data a widget must have before it can show a number, and who provides it.
 * Generated from the dashboards library draft on 2026-10-06; edit here from now on.
 */

/** data: the customer sends it; setup: the customer turns it on; feature: LangWatch builds it. */
export type RequirementKind = "data" | "setup" | "feature";

export interface DataRequirement {
  readonly key: string;
  readonly name: string;
  readonly kind: RequirementKind;
  /** Share of orgs that have it today, or null when not measured. */
  readonly coveragePercent: number | null;
  readonly note: string;
}

export const DATA_REQUIREMENTS: readonly DataRequirement[] = [
  {
    key: "traces",
    name: "Traces",
    kind: "data",
    coveragePercent: 100,
    note: "Every project with traffic.",
  },
  {
    key: "errors",
    name: "Error status on spans",
    kind: "data",
    coveragePercent: 61,
    note: "Orgs with any error status recorded.",
  },
  { key: "model", name: "Model name", kind: "data", coveragePercent: 49, note: "" },
  { key: "cost", name: "Cost and tokens", kind: "data", coveragePercent: 39, note: "" },
  {
    key: "thread",
    name: "Conversation id",
    kind: "data",
    coveragePercent: 32,
    note: "Thread id on the trace.",
  },
  { key: "user", name: "User id", kind: "data", coveragePercent: 24, note: "" },
  {
    key: "labels",
    name: "Labels or metadata",
    kind: "data",
    coveragePercent: 22,
    note: "Used to split by language, channel, document type.",
  },
  {
    key: "steps",
    name: "Tool and step spans",
    kind: "data",
    coveragePercent: 17,
    note: "Tool-call spans on at least half the traces.",
  },
  {
    key: "evals",
    name: "Evaluator results",
    kind: "data",
    coveragePercent: 13,
    note: "Online evaluators that actually produced results, not just monitors that are switched on.",
  },
  {
    key: "topics",
    name: "Topics",
    kind: "data",
    coveragePercent: 11,
    note: "Topic clustering on traces.",
  },
  {
    key: "deploys",
    name: "Deploy or environment tag",
    kind: "data",
    coveragePercent: 9,
    note: "An environment or deploy key in metadata.",
  },
  { key: "rag", name: "Retrieved contexts", kind: "data", coveragePercent: 7, note: "" },
  {
    key: "customer",
    name: "Customer id",
    kind: "data",
    coveragePercent: 6,
    note: "Only 22 orgs have two or more customer ids.",
  },
  {
    key: "thumbs",
    name: "End-user thumbs events",
    kind: "feature",
    coveragePercent: 0,
    note: "The customer's app sends thumbs as span events (6% of orgs do), but LWQL cannot read span events, so no dashboard can show them yet.",
  },
  {
    key: "outcome",
    name: "Outcome event",
    kind: "data",
    coveragePercent: 2,
    note: "A metadata key such as outcome = resolved, handed off, booked. 8 of 407 projects send one.",
  },
  {
    key: "annotations",
    name: "Reviewer annotations",
    kind: "data",
    coveragePercent: 2,
    note: "Thumbs and notes from people reviewing traces inside LangWatch.",
  },
  {
    key: "voice",
    name: "Voice stage timings",
    kind: "data",
    coveragePercent: 2,
    note: "Listen, think and speak spans or attributes.",
  },
  {
    key: "prompts",
    name: "Prompt version on trace",
    kind: "data",
    coveragePercent: 1,
    note: "Needed to mark changes on charts and compare before and after.",
  },
  { key: "guardrails", name: "Guardrail results", kind: "data", coveragePercent: 1, note: "" },
  {
    key: "scenarios",
    name: "Scenario runs",
    kind: "data",
    coveragePercent: 17,
    note: "69 of 407 projects ran simulations in 30 days (share of projects).",
  },
  {
    key: "experiments",
    name: "Experiment runs",
    kind: "data",
    coveragePercent: 10,
    note: "39 of 407 projects ran evaluations on a dataset in 30 days (share of projects).",
  },
  {
    key: "fields",
    name: "Per-field checks",
    kind: "data",
    coveragePercent: null,
    note: "An evaluator result per extracted field. Not measured.",
  },
  {
    key: "judge",
    name: "Conversation outcome judge",
    kind: "setup",
    coveragePercent: 1,
    note: "A thread-level category judge that labels how each conversation ended (resolved, misunderstood, cannot do, refused, handed off) and why. LangWatch has every part: thread-level monitors, the LLM category judge and the Label column. It lacks a ready preset, so almost nobody runs one: 41 of 859 monitors are thread-level, and the category judge produced results in 4 projects in 30 days. One LLM call per conversation.",
  },
  {
    key: "budget",
    name: "Budget on project spend",
    kind: "feature",
    coveragePercent: 0,
    note: "Budgets exist for gateway traffic (gateway_budgets). A budget over a project's trace cost does not.",
  },
  {
    key: "vendor",
    name: "Speech vendor rates",
    kind: "feature",
    coveragePercent: 0,
    note: "Speech-to-text and text-to-speech prices, set by the user.",
  },
  {
    key: "gateway",
    name: "Gateway traffic",
    kind: "data",
    coveragePercent: 6,
    note: "23 of 407 projects route through the LangWatch gateway.",
  },
  {
    key: "prs",
    name: "GitHub pull requests",
    kind: "setup",
    coveragePercent: null,
    note: "Pull requests synced by the GitHub integration, joined to coding sessions by branch. Coverage not measured.",
  },
  {
    key: "coding",
    name: "Coding-agent traces",
    kind: "data",
    coveragePercent: null,
    note: "144 projects receive coding-agent traces, but only 7 paying orgs. Not comparable with application coverage.",
  },
  {
    key: "valueset",
    name: "Value settings",
    kind: "feature",
    coveragePercent: 0,
    note: "The customer's own value of one task. Optional, never a headline.",
  },
  {
    key: "projects",
    name: "Several projects",
    kind: "data",
    coveragePercent: null,
    note: "Org-wide views need more than one project.",
  },
  { key: "tokens", name: "Token counts", kind: "data", coveragePercent: 43, note: "" },
  {
    key: "spans",
    name: "Spans inside traces",
    kind: "data",
    coveragePercent: 56,
    note: "LLM or step spans on at least half the traces.",
  },
  {
    key: "satscore",
    name: "Satisfaction score",
    kind: "data",
    coveragePercent: null,
    note: "LangWatch derives it per trace. Coverage not measured.",
  },
  {
    key: "history",
    name: "Change history in LangWatch",
    kind: "data",
    coveragePercent: null,
    note: "LWQL already has prompt_versions (author, message, time). Covers prompts managed in LangWatch only. Coverage not measured.",
  },
  {
    key: "seats",
    name: "Seat licences in LWQL",
    kind: "feature",
    coveragePercent: 0,
    note: "Governance pulls seat licences from AI vendors and its cost screen shows seats bought and assigned. LWQL cannot read them yet.",
  },
];
