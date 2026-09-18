/**
 * The ACME company world, ported from the prototype's
 * `src/lib/data/{catalog,entities,usage,plans}.ts`. Only the pieces the FinOps
 * (`finops_usage`) and coding-agent boards read are carried across; the
 * numbers are the prototype's, so the seeded boards reproduce its magnitudes.
 */

/* ---------- directory ---------- */

export const DEPARTMENTS = [
  { id: "engineering", name: "Engineering" },
  { id: "data", name: "Data & AI" },
  { id: "support", name: "Customer Support" },
  { id: "marketing", name: "Marketing" },
] as const;

export const TEAMS = [
  { id: "platform", name: "Platform", deptId: "engineering" },
  { id: "checkout", name: "Checkout", deptId: "engineering" },
  { id: "ai-tools", name: "AI Tools", deptId: "engineering" },
  { id: "ml", name: "ML", deptId: "data" },
  { id: "analytics", name: "Analytics", deptId: "data" },
  { id: "support-ops", name: "Support Ops", deptId: "support" },
  { id: "growth", name: "Growth", deptId: "marketing" },
] as const;

export const EMAIL_DOMAIN = "acme.dev";
export const UNALLOCATED = "unallocated";

/** 24 people; [name, teamId, title]. Riley Chen is the prototype "me". */
export const PEOPLE_SPEC: [string, string, string][] = [
  ["Riley Chen", "platform", "Staff Engineer"],
  ["Sarah Kim", "platform", "Senior Engineer"],
  ["Marcus Webb", "platform", ""],
  ["Ana Souza", "platform", "Engineering Manager"],
  ["Tom Okafor", "checkout", "Senior Engineer"],
  ["Lena Fischer", "checkout", "Engineer"],
  ["Diego Ramos", "checkout", "Engineer"],
  ["Priya Nair", "ai-tools", "Senior Engineer"],
  ["Jonas Berg", "ai-tools", "Engineer"],
  ["Maya Goldstein", "ai-tools", "Engineer"],
  ["Chris Doyle", "ml", "ML Engineer"],
  ["Fatima Al-Sayed", "ml", "Data Scientist"],
  ["Viktor Petrov", "ml", "ML Engineer"],
  ["Grace Liu", "analytics", "Analytics Engineer"],
  ["Sam Taylor", "analytics", "Data Analyst"],
  ["Nina Rossi", "analytics", "Data Analyst"],
  ["Omar Haddad", "support-ops", "Support Lead"],
  ["Julia Novak", "support-ops", "Support Specialist"],
  ["Ben Carter", "support-ops", "Support Specialist"],
  ["Aisha Bello", "support-ops", ""],
  ["Leo Martins", "growth", "Growth Marketer"],
  ["Emma Wright", "growth", "Content Lead"],
  ["Raj Patel", "growth", "Marketing Ops"],
  ["Zoe Laurent", "growth", "Designer"],
];

export function personId(name: string): string {
  return `p-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
}

/* ---------- providers / models ---------- */

export type ProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "microsoft"
  | "github"
  | "anysphere"
  | "databricks"
  | "azure";

/** Blended effective $/M tokens per model (cache-mix adjusted). */
export const MODEL_RATES: Record<string, number> = {
  "claude-sonnet-4.5": 6,
  "claude-opus-4.5": 30,
  "claude-opus-5": 0.8,
  "claude-fable-5": 1.6,
  "claude-sonnet-5": 0.35,
  "gpt-5": 10,
  "gpt-5-mini": 1.5,
  "llama-4-70b": 2,
  "gemini-2.5-pro": 7,
};

export const MODEL_PROVIDER: Record<string, ProviderId> = {
  "claude-sonnet-4.5": "anthropic",
  "claude-opus-4.5": "anthropic",
  "gpt-5": "openai",
  "gpt-5-mini": "openai",
  "gemini-2.5-pro": "google",
  "llama-4-70b": "azure",
};

export const PROVIDER_DISCOUNT: Record<ProviderId, number> = {
  anthropic: 0.18,
  openai: 0.12,
  google: 0.1,
  microsoft: 0.25,
  github: 0.15,
  anysphere: 0,
  databricks: 0.22,
  azure: 0.3,
};

/* ---------- tools ---------- */

export type CostLayer = "cloud" | "direct" | "tool";

export interface ToolDef {
  id: string;
  name: string;
  seats: number;
  activeSeats: number;
  costPerSeatMonth: number;
}

export const TOOLS: ToolDef[] = [
  { id: "claude-code", name: "Claude Code", seats: 60, activeSeats: 44, costPerSeatMonth: 100 },
  { id: "claude-cowork", name: "Claude Cowork", seats: 30, activeSeats: 22, costPerSeatMonth: 30 },
  { id: "copilot", name: "GitHub Copilot", seats: 120, activeSeats: 87, costPerSeatMonth: 19 },
  { id: "cursor", name: "Cursor", seats: 40, activeSeats: 31, costPerSeatMonth: 20 },
  { id: "chatgpt", name: "ChatGPT Enterprise", seats: 80, activeSeats: 52, costPerSeatMonth: 25 },
  { id: "databricks", name: "Databricks Genie", seats: 0, activeSeats: 0, costPerSeatMonth: 0 },
  { id: "copilot-studio", name: "Copilot Studio", seats: 15, activeSeats: 6, costPerSeatMonth: 200 },
  { id: "custom", name: "Custom Agents", seats: 0, activeSeats: 0, costPerSeatMonth: 0 },
];

export const TOOL_NAME: Record<string, string> = Object.fromEntries(
  TOOLS.map((t) => [t.id, t.name]),
);

export const TOOL_MODELS: Record<string, [string, number][]> = {
  "claude-code": [
    ["claude-opus-5", 0.55],
    ["claude-fable-5", 0.35],
    ["claude-sonnet-5", 0.1],
  ],
  "claude-cowork": [
    ["claude-sonnet-5", 0.85],
    ["claude-opus-5", 0.15],
  ],
  copilot: [
    ["gpt-5-mini", 0.8],
    ["gpt-5", 0.2],
  ],
  cursor: [
    ["claude-sonnet-5", 0.55],
    ["gpt-5", 0.45],
  ],
  chatgpt: [["gpt-5", 1]],
  databricks: [
    ["llama-4-70b", 0.6],
    ["claude-sonnet-4.5", 0.4],
  ],
  "copilot-studio": [["gpt-5", 1]],
  custom: [
    ["claude-sonnet-4.5", 0.6],
    ["gpt-5", 0.3],
    ["gpt-5-mini", 0.1],
  ],
};

/** per-dept [toolId, probability a person uses it, base requests/day] */
export const DEPT_TOOL_AFFINITY: Record<string, [string, number, number][]> = {
  engineering: [
    ["claude-code", 0.9, 38],
    ["copilot", 0.75, 55],
    ["cursor", 0.35, 30],
  ],
  data: [
    ["claude-code", 0.55, 26],
    ["copilot", 0.4, 30],
    ["chatgpt", 0.7, 14],
    ["claude-cowork", 0.3, 8],
    ["databricks", 0.85, 22],
  ],
  support: [
    ["chatgpt", 0.8, 18],
    ["claude-cowork", 0.5, 12],
    ["copilot-studio", 0.35, 10],
  ],
  marketing: [
    ["chatgpt", 0.9, 16],
    ["claude-cowork", 0.65, 14],
    ["cursor", 0.15, 8],
  ],
};

export const TOOL_TOKENS_PER_REQ: Record<string, number> = {
  "claude-code": 2_100_000,
  "claude-cowork": 2_600,
  copilot: 1_800,
  cursor: 14_000,
  chatgpt: 2_400,
  databricks: 5_200,
  "copilot-studio": 3_000,
  custom: 3_200,
};

export const TOOL_LAYER: Record<string, CostLayer> = {
  "claude-code": "direct",
  "claude-cowork": "direct",
  custom: "direct",
  databricks: "cloud",
  "copilot-studio": "cloud",
  copilot: "tool",
  cursor: "tool",
  chatgpt: "tool",
};

export const TOOL_PROVIDER: Record<string, ProviderId> = {
  "claude-code": "anthropic",
  "claude-cowork": "anthropic",
  copilot: "github",
  cursor: "anysphere",
  chatgpt: "openai",
  databricks: "databricks",
  "copilot-studio": "microsoft",
  custom: "azure",
};

/* ---------- projects (LLM Ops) ---------- */

export const PROJECTS = [
  { id: "checkout-agent", teamId: "checkout" },
  { id: "support-copilot", teamId: "support-ops" },
  { id: "docs-rag", teamId: "ai-tools" },
  { id: "fraud-triage", teamId: "ml" },
] as const;

export const PROJECT_TRAFFIC: Record<
  string,
  { reqPerDay: number; tokPerReq: number; models: [string, number][] }
> = {
  "checkout-agent": { reqPerDay: 2600, tokPerReq: 3000, models: [["claude-sonnet-4.5", 0.85], ["gpt-5-mini", 0.15]] },
  "support-copilot": { reqPerDay: 1640, tokPerReq: 3200, models: [["gpt-5", 1]] },
  "docs-rag": { reqPerDay: 900, tokPerReq: 2200, models: [["gpt-5-mini", 0.7], ["gemini-2.5-pro", 0.3]] },
  "fraud-triage": { reqPerDay: 750, tokPerReq: 5200, models: [["llama-4-70b", 0.75], ["claude-sonnet-4.5", 0.25]] },
};

/* ---------- cloud (Databricks / Azure) ---------- */

export const DBU_LIST_RATE = 0.55;
export const DSU_LIST_RATE = 0.07;

export interface CloudSpend {
  id: string;
  name: string;
  provider: ProviderId;
  toolId: string;
  unit: "dbu" | "dsu" | "compute-hour";
  deptId?: string;
  teamId?: string;
  perDay: number;
  unitRate: number;
}

export const CLOUD_SPEND: CloudSpend[] = [
  { id: "azure-aifoundry", name: "Azure AI Foundry", provider: "azure", toolId: "custom", unit: "compute-hour", deptId: "engineering", teamId: "platform", perDay: 74, unitRate: 3.1 },
  { id: "azure-agentruntime", name: "Azure agent runtime", provider: "azure", toolId: "custom", unit: "compute-hour", deptId: "engineering", teamId: "checkout", perDay: 41, unitRate: 2.4 },
  { id: "azure-storage", name: "Azure storage & egress", provider: "azure", toolId: "custom", unit: "compute-hour", perDay: 22, unitRate: 0.9 },
  { id: "dbx-genie-warehouse", name: "Genie SQL warehouse", provider: "databricks", toolId: "databricks", unit: "dbu", deptId: "data", teamId: "analytics", perDay: 48, unitRate: DBU_LIST_RATE },
  { id: "dbx-genie-serving", name: "Genie model serving", provider: "databricks", toolId: "databricks", unit: "dbu", deptId: "data", teamId: "ml", perDay: 31, unitRate: DBU_LIST_RATE },
  { id: "dbx-shared-jobs", name: "Shared job compute", provider: "databricks", toolId: "databricks", unit: "dbu", perDay: 17, unitRate: DBU_LIST_RATE },
  { id: "dbx-genie-storage", name: "Genie workspace storage", provider: "databricks", toolId: "databricks", unit: "dsu", deptId: "data", teamId: "analytics", perDay: 6, unitRate: DSU_LIST_RATE },
];

export const GENIE_CONVERSATION_RESOURCE = "dbx-genie-conversations";

/** [person name, conversations/day] */
export const GENIE_ASKERS: [string, number][] = [
  ["Grace Liu", 14],
  ["Sam Taylor", 11],
  ["Nina Rossi", 9],
  ["Fatima Al-Sayed", 8],
  ["Viktor Petrov", 6],
  ["Chris Doyle", 4],
];

/* ---------- entities (people, agents, keys) ---------- */

export interface Person {
  id: string;
  name: string;
  teamId: string;
  deptId: string;
  isMe: boolean;
}
export interface AgentDef {
  id: string;
  source: "custom" | "databricks" | "copilot-studio";
  deptId: string;
  projectId?: string;
  model: string;
  status: "active" | "idle" | "error";
  createdDay: number;
}
export interface VirtualKey {
  id: string;
  createdDay: number;
}

/** [name, source, deptId, projectId, model, status, createdDay] */
const AGENT_SPEC: [string, AgentDef["source"], string, string | undefined, string, AgentDef["status"], number][] = [
  ["checkout-agent-prod", "custom", "engineering", "checkout-agent", "claude-sonnet-4.5", "active", 10],
  ["support-copilot-prod", "custom", "support", "support-copilot", "gpt-5", "active", 15],
  ["docs-rag-prod", "custom", "engineering", "docs-rag", "gpt-5-mini", "active", 22],
  ["fraud-triage-prod", "custom", "data", "fraud-triage", "llama-4-70b", "active", 18],
  ["onboarding-helper", "custom", "engineering", undefined, "claude-sonnet-4.5", "idle", 40],
  ["sql-assistant", "databricks", "data", undefined, "llama-4-70b", "active", 20],
  ["churn-predictor", "databricks", "data", undefined, "llama-4-70b", "active", 30],
  ["revenue-forecaster", "databricks", "data", undefined, "claude-sonnet-4.5", "active", 45],
  ["data-quality-bot", "databricks", "data", undefined, "llama-4-70b", "active", 55],
  ["etl-doctor", "databricks", "data", undefined, "claude-sonnet-4.5", "error", 60],
  ["hr-helpdesk", "copilot-studio", "support", undefined, "gpt-5", "active", 25],
  ["it-desk-bot", "copilot-studio", "support", undefined, "gpt-5", "active", 35],
  ["sales-brief-bot", "copilot-studio", "marketing", undefined, "gpt-5", "idle", 50],
  ["meeting-summarizer", "copilot-studio", "marketing", undefined, "gpt-5", "active", 28],
];

export interface WorldEntities {
  people: Person[];
  agents: AgentDef[];
  keys: VirtualKey[];
  teamById: Map<string, { id: string; name: string; deptId: string }>;
  deptById: Map<string, { id: string; name: string }>;
}

export function buildEntities(): WorldEntities {
  const teamById = new Map<string, { id: string; name: string; deptId: string }>(
    TEAMS.map((t) => [t.id, { id: t.id, name: t.name, deptId: t.deptId }]),
  );
  const deptById = new Map<string, { id: string; name: string }>(
    DEPARTMENTS.map((d) => [d.id, { id: d.id, name: d.name }]),
  );
  const people: Person[] = PEOPLE_SPEC.map(([name, teamId], i) => ({
    id: personId(name),
    name,
    teamId,
    deptId: teamById.get(teamId)!.deptId,
    isMe: i === 0,
  }));
  const agents: AgentDef[] = AGENT_SPEC.map(([id, source, deptId, projectId, model, status, createdDay]) => ({
    id,
    source,
    deptId,
    projectId,
    model,
    status,
    createdDay,
  }));
  const keys: VirtualKey[] = [
    { id: "key-prod-main", createdDay: 5 },
    { id: "key-checkout-prod", createdDay: 10 },
    { id: "key-support-prod", createdDay: 15 },
    { id: "key-docs-rag", createdDay: 22 },
    { id: "key-fraud", createdDay: 18 },
    { id: "key-data-dept", createdDay: 8 },
    { id: "key-riley-dev", createdDay: 30 },
    { id: "key-sarah-dev", createdDay: 33 },
    { id: "key-ci", createdDay: 12 },
    { id: "key-cust-nimbus", createdDay: 40 },
    { id: "key-cust-northwind", createdDay: 48 },
    { id: "key-cust-zephyr", createdDay: 55 },
  ];
  return { people, agents, keys, teamById, deptById };
}
