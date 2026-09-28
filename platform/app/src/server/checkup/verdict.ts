/**
 * What one checkup row says (specs/self-hosting/checkup/checkup.feature).
 *
 * Three outcomes, and the vocabulary is the one the model provider connection
 * test already speaks (`providerValidation.ts`): a check that ran and was
 * satisfied is `verified`, one that ran and found the problem is `refused`,
 * and one that could not run is `unchecked`. The third is an answer, not a
 * missing one, and the page never colours it green: "we could not tell" and
 * "it works" are different facts, and a checkup that blurs them is the kind
 * an operator stops reading.
 */

export const CHECK_OUTCOMES = ["verified", "refused", "unchecked"] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

export type CheckVerdict =
  | {
      readonly outcome: "verified";
      /** One line under the row's name: what was found. */
      readonly detail: string;
    }
  | {
      readonly outcome: "refused";
      /**
       * Stable, so a runbook can match on it. Where a `HandledError` code
       * exists for the failure it is that code, and the page renders its copy
       * from the presentation registry; otherwise a `checkup_*` code of its
       * own.
       */
      readonly code: string;
      readonly detail: string;
      /** What to do about it, in one or two sentences. */
      readonly fix: string;
      /** The docs page that explains it, repo-relative, leading slash. */
      readonly docsPath: string;
      /** What the presentation registry reads for this code, if anything. */
      readonly meta?: Record<string, unknown>;
    }
  | {
      readonly outcome: "unchecked";
      /** Why it could not be checked, or was not asked for. */
      readonly detail: string;
      /** What would make it checkable, where there is such a thing. */
      readonly fix?: string;
      readonly docsPath?: string;
    };

/** Which part of the page a row sits in. */
export const CHECK_GROUPS = [
  "install",
  "langwatch",
  "integrations",
  "pipelines",
] as const;
export type CheckGroup = (typeof CHECK_GROUPS)[number];

/**
 * What running a check costs. `free` checks run when the page opens; the
 * other two run only when an administrator asks, because one opens an
 * outbound connection and the other spends money on a model or a judge.
 */
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
  {
    id: "postgres_migrations",
    name: "Postgres migrations",
    group: "install",
    cost: "free",
  },
  { id: "clickhouse", name: "ClickHouse", group: "install", cost: "free" },
  {
    id: "clickhouse_migrations",
    name: "ClickHouse migrations",
    group: "install",
    cost: "free",
  },
  { id: "lwql", name: "LWQL functions", group: "install", cost: "free" },
  { id: "redis", name: "Redis", group: "install", cost: "free" },
  { id: "gateway", name: "AI Gateway", group: "install", cost: "free" },
  { id: "license", name: "License", group: "langwatch", cost: "free" },
  { id: "connect", name: "Connect", group: "langwatch", cost: "free" },
  {
    id: "usage_report",
    name: "Usage report",
    group: "langwatch",
    cost: "free",
  },
  {
    id: "reach_connect_host",
    name: "Reach the connect host",
    group: "langwatch",
    cost: "egress",
  },
  {
    id: "reach_gateway_host",
    name: "Reach the gateway host",
    group: "langwatch",
    cost: "egress",
  },
  {
    id: "gateway_control_plane",
    name: "AI Gateway control plane",
    group: "langwatch",
    cost: "egress",
  },
  { id: "storage", name: "Storage", group: "integrations", cost: "free" },
  { id: "email", name: "Email", group: "integrations", cost: "free" },
  {
    id: "model_providers",
    name: "Model providers",
    group: "integrations",
    cost: "free",
  },
  {
    id: "storage_probe",
    name: "Storage write and delete",
    group: "integrations",
    cost: "egress",
  },
  {
    id: "smtp_verify",
    name: "SMTP connection",
    group: "integrations",
    cost: "egress",
  },
  {
    id: "model_provider_test",
    name: "Model provider connection",
    group: "integrations",
    cost: "paid",
  },
  {
    id: "canary_collector",
    name: "Collector",
    group: "pipelines",
    cost: "egress",
  },
  {
    id: "canary_processor",
    name: "Processor",
    group: "pipelines",
    cost: "egress",
  },
  {
    id: "canary_evaluations",
    name: "Evaluations",
    group: "pipelines",
    cost: "paid",
  },
  {
    id: "canary_scenarios",
    name: "Scenarios",
    group: "pipelines",
    cost: "paid",
  },
  { id: "canary_langy", name: "Langy", group: "pipelines", cost: "paid" },
];

export interface CheckRow extends CheckDefinition {
  readonly verdict: CheckVerdict;
}

export function checkDefinition(id: CheckId): CheckDefinition {
  const definition = CHECK_DEFINITIONS.find((entry) => entry.id === id);
  if (!definition) throw new Error(`no checkup row named ${id}`);
  return definition;
}

/** The rows that run when the page opens. */
export function freeCheckIds(): CheckId[] {
  return CHECK_DEFINITIONS.filter((entry) => entry.cost === "free").map(
    (entry) => entry.id,
  );
}

/** The rows that run only when asked for. */
export function explicitCheckIds(): CheckId[] {
  return CHECK_DEFINITIONS.filter((entry) => entry.cost !== "free").map(
    (entry) => entry.id,
  );
}

/** The one shape a check that was not asked for reads as. */
export function notAskedFor(): CheckVerdict {
  return {
    outcome: "unchecked",
    detail:
      "Not run. This check opens a connection or spends money, so it runs only when you ask for it.",
  };
}

/**
 * A check whose probe threw before it could answer.
 *
 * The exception is the reason, in one line: an operator reading "not checked"
 * with no reason has learned less than one reading a stack trace.
 */
export function couldNotRun(error: unknown): CheckVerdict {
  const reason =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  return {
    outcome: "unchecked",
    detail: `The check itself failed before it could answer: ${firstLine(reason)}`,
  };
}

export function firstLine(text: string): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}
