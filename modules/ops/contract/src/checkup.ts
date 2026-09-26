/**
 * The rows of a self-hosted install's checkup, and the three things a row can
 * say (specs/self-hosting/checkup/checkup.feature). `unchecked` is an answer:
 * "we could not tell" is never drawn as "it works".
 */

import { z } from "zod";

import { usageReportPreviewSchema } from "./checkup-usage-report.ts";

export const CHECK_OUTCOMES = ["verified", "refused", "unchecked"] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

/** Which part of the page a row sits in. */
export const CHECK_GROUPS = ["install", "langwatch", "integrations", "pipelines"] as const;
export type CheckGroup = (typeof CHECK_GROUPS)[number];

/** `free` runs when the page opens; egress and paid run only when an administrator asks. */
export const CHECK_COSTS = ["free", "egress", "paid"] as const;
export type CheckCost = (typeof CHECK_COSTS)[number];

/** Every row the checkup has, in the order the page lists them. */
export const CHECK_IDS = [
  "app",
  "postgres",
  "postgres_migrations",
  "clickhouse",
  "clickhouse_migrations",
  "lwql",
  "redis",
  "gateway",
  "license",
  "connect",
  "usage_report",
  "reach_connect_host",
  "reach_gateway_host",
  "gateway_control_plane",
  "storage",
  "email",
  "model_providers",
  "storage_probe",
  "smtp_verify",
  "model_provider_test",
  "canary_collector",
  "canary_processor",
  "canary_evaluations",
  "canary_scenarios",
  "canary_langy",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export const checkIdSchema = z.enum(CHECK_IDS);

export interface CheckDefinition {
  readonly id: CheckId;
  readonly name: string;
  readonly group: CheckGroup;
  readonly cost: CheckCost;
}

/** The rows, their names as the page shows them, and what each costs. */
export const CHECK_DEFINITIONS: readonly CheckDefinition[] = [
  { id: "app", name: "Application", group: "install", cost: "free" },
  { id: "postgres", name: "Postgres", group: "install", cost: "free" },
  { id: "postgres_migrations", name: "Postgres migrations", group: "install", cost: "free" },
  { id: "clickhouse", name: "ClickHouse", group: "install", cost: "free" },
  { id: "clickhouse_migrations", name: "ClickHouse migrations", group: "install", cost: "free" },
  { id: "lwql", name: "LWQL functions", group: "install", cost: "free" },
  { id: "redis", name: "Redis", group: "install", cost: "free" },
  { id: "gateway", name: "AI Gateway", group: "install", cost: "free" },
  { id: "license", name: "License", group: "langwatch", cost: "free" },
  { id: "connect", name: "Connect", group: "langwatch", cost: "free" },
  { id: "usage_report", name: "Usage report", group: "langwatch", cost: "free" },
  { id: "reach_connect_host", name: "Reach the connect host", group: "langwatch", cost: "egress" },
  { id: "reach_gateway_host", name: "Reach the gateway host", group: "langwatch", cost: "egress" },
  {
    id: "gateway_control_plane",
    name: "AI Gateway control plane",
    group: "langwatch",
    cost: "egress",
  },
  { id: "storage", name: "Storage", group: "integrations", cost: "free" },
  { id: "email", name: "Email", group: "integrations", cost: "free" },
  { id: "model_providers", name: "Model providers", group: "integrations", cost: "free" },
  { id: "storage_probe", name: "Storage write and delete", group: "integrations", cost: "egress" },
  { id: "smtp_verify", name: "SMTP connection", group: "integrations", cost: "egress" },
  {
    id: "model_provider_test",
    name: "Model provider connection",
    group: "integrations",
    cost: "paid",
  },
  { id: "canary_collector", name: "Collector", group: "pipelines", cost: "egress" },
  { id: "canary_processor", name: "Processor", group: "pipelines", cost: "egress" },
  { id: "canary_evaluations", name: "Evaluations", group: "pipelines", cost: "paid" },
  { id: "canary_scenarios", name: "Scenarios", group: "pipelines", cost: "paid" },
  { id: "canary_langy", name: "Langy", group: "pipelines", cost: "paid" },
];

/** The definition of one row; a row the checkup does not have throws. */
export function getCheckDefinition(id: CheckId): CheckDefinition {
  const definition = CHECK_DEFINITIONS.find((entry) => entry.id === id);
  if (!definition) throw new Error(`no checkup row named ${id}`);
  return definition;
}

/** The rows that run when the page opens. */
export function freeCheckIds(): CheckId[] {
  return CHECK_DEFINITIONS.filter((entry) => entry.cost === "free").map((entry) => entry.id);
}

/** The rows that run only when asked for. */
export function explicitCheckIds(): CheckId[] {
  return CHECK_DEFINITIONS.filter((entry) => entry.cost !== "free").map((entry) => entry.id);
}

/** The docs page each refusal links, repo-relative with a leading slash. */
export const CHECKUP_DOCS = {
  checkup: "/self-hosting/checkup",
  connect: "/self-hosting/connect",
  telemetry: "/self-hosting/data-and-telemetry",
  upgrade: "/self-hosting/upgrade",
  troubleshooting: "/self-hosting/troubleshooting",
  email: "/self-hosting/configuration/email",
  environment: "/self-hosting/configuration/environment-variables",
  licensing: "/self-hosting/licensing",
  modelProviders: "/self-hosting/configuration/environment-variables",
  gateway: "/ai-gateway/self-hosting/overview",
  lwql: "/self-hosting/troubleshooting",
} as const;

/**
 * A verdict. Detail, fix, code and docs name hosts, ports, env vars and versions, so only
 * an install admin reads them; an organization caller reads the outcome alone
 * (modules/ops/specs/checkup-audience.feature).
 */
export const checkVerdictSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("verified"), detail: z.string().optional() }),
  z.object({
    outcome: z.literal("refused"),
    /** Stable, so a runbook matches on it: a `HandledError` code or a `checkup_*` one. */
    code: z.string().optional(),
    detail: z.string().optional(),
    fix: z.string().optional(),
    docsPath: z.string().optional(),
    /** What the presentation registry reads for this code, if anything. */
    meta: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    outcome: z.literal("unchecked"),
    detail: z.string().optional(),
    fix: z.string().optional(),
    docsPath: z.string().optional(),
  }),
]);
export type CheckVerdict = z.infer<typeof checkVerdictSchema>;

export const checkRowSchema = z.object({
  id: checkIdSchema,
  name: z.string(),
  group: z.enum(CHECK_GROUPS),
  cost: z.enum(CHECK_COSTS),
  verdict: checkVerdictSchema,
});
export type CheckRow = z.infer<typeof checkRowSchema>;

export const checkupResultSchema = z.object({
  ranAt: z.string(),
  rows: z.array(checkRowSchema),
});
export type CheckupResult = z.infer<typeof checkupResultSchema>;

/** What an explicit run may be given. The scenario canary needs a run plan to launch. */
export const explicitCheckInputSchema = z.object({
  checks: z.array(checkIdSchema).optional(),
  scenarioRunPlanId: z.string().min(1).max(200).optional(),
});
export type ExplicitCheckInput = z.infer<typeof explicitCheckInputSchema>;

/** The free checks and the usage report preview, as the REST checkup answers them. */
export const projectCheckupReportSchema = z.object({
  ...checkupResultSchema.shape,
  usageReport: usageReportPreviewSchema,
});
export type ProjectCheckupReport = z.infer<typeof projectCheckupReportSchema>;
