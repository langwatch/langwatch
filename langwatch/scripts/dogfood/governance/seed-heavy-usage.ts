/**
 * Heavy-usage seed for the /me/usage + /gateway/usage + /governance
 * dashboard captures. Inserts a realistic month of trace_summaries +
 * gateway_budget_ledger_events rows distributed across the past 30
 * days so the dashboards render populated charts instead of empty
 * states.
 *
 * The shape mirrors what real OpenAI/Anthropic completions through
 * the Go gateway would land — same TenantId discipline, same
 * `langwatch.virtual_key_id` + `langwatch.gateway_request_id` attrs,
 * same cost/token shapes — only OccurredAt is backdated to spread
 * across the window.
 *
 * Usage (from langwatch/ workspace):
 *   pnpm tsx scripts/dogfood/governance/seed-heavy-usage.ts \
 *     --personal-project <projectId> \
 *     --virtual-key <vkId> \
 *     --budget <budgetId> \
 *     [--days 30] [--rows 150]
 *
 * Find the inputs via prior `seed-personas.ts --mint-vk` output.
 */
import { randomBytes } from "crypto";

import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";

export interface Args {
  personalProject: string;
  virtualKey: string;
  /**
   * Budget id to record `gateway_budget_ledger_events` rows against. When
   * omitted the action seeds `trace_summaries` only, which still
   * populates the /me/usage spend chart (it reads from trace_summaries),
   * but the per-budget detail page won't render new rows.
   */
  budget: string | undefined;
  days: number;
  rows: number;
}

export interface SeedHeavyUsageSummary {
  tenantId: string;
  rowsInserted: number;
  totalCostUsd: number;
  spanDays: number;
  budgetSeeded: boolean;
  byModel: Record<string, { rows: number; costUsd: number }>;
}

interface ModelMix {
  name: string;
  costPerInputToken: number;
  costPerOutputToken: number;
  weight: number;
  promptRange: [number, number];
  completionRange: [number, number];
}

const MODELS: ModelMix[] = [
  {
    name: "claude-sonnet-4-7",
    costPerInputToken: 0.000003,
    costPerOutputToken: 0.000015,
    weight: 0.50,
    promptRange: [50, 2000],
    completionRange: [80, 1800],
  },
  {
    name: "claude-opus-4-7",
    costPerInputToken: 0.000015,
    costPerOutputToken: 0.000075,
    weight: 0.20,
    promptRange: [80, 3000],
    completionRange: [120, 2500],
  },
  {
    name: "claude-haiku-4-5",
    costPerInputToken: 0.0000008,
    costPerOutputToken: 0.000004,
    weight: 0.15,
    promptRange: [20, 1000],
    completionRange: [10, 800],
  },
  {
    name: "gpt-5-mini",
    costPerInputToken: 0.00000025,
    costPerOutputToken: 0.000002,
    weight: 0.10,
    promptRange: [12, 800],
    completionRange: [10, 600],
  },
  {
    name: "gemini-2-5-pro",
    costPerInputToken: 0.00000125,
    costPerOutputToken: 0.000005,
    weight: 0.05,
    promptRange: [30, 1500],
    completionRange: [40, 1200],
  },
];

const SAMPLE_PROMPTS = [
  "Summarise the latest quarterly product update for the leadership readout.",
  "Refactor this hot-loop to be branch-free; explain the SIMD trade-offs.",
  "Draft a customer-facing changelog entry for the routing-policy GA.",
  "Why is my prisma migration deadlocking against gateway_budget_ledger_events?",
  "Write a haiku about retrieval-augmented generation.",
  "Translate this pitch deck slide into product-marketing copy.",
  "Triage this ClickHouse error: code 184 ILLEGAL_AGGREGATION.",
  "Generate an OpenAPI 3 schema from these example payloads.",
  "Plan a 3-step rollout for the persona-aware sidebar gating.",
  "Explain the difference between event-sourcing folds and reactors.",
];

const SAMPLE_OUTPUTS = [
  "Q4 shipped routing policies, ingestion sources, and the unified governance substrate. Adoption is on track.",
  "Removed the conditional via SIMD compare/select; speedup ~3.2x on AVX-512 hosts. Trade-off: branch predictor wins at low N.",
  "Routing policies are now in GA. Pin a primary, add fallbacks, hot-swap from the drawer.",
  "Likely a CH ALTER mid-MV materialise. Pause writes, ALTER, resume — see migration 00017 notes.",
  "Tokens drift on the wind / Vector store hums in silence / Knowledge takes its place",
  "Lead with the customer pain, anchor on the routing-policy GA, close with a quote from the design partner.",
  "argMax(...) inside an outer sum() in the same SELECT level. Wrap in a subquery or rename the inner alias.",
  "Generated. Endpoints inferred from POST/GET pairs; auth scheme assumed Bearer JWT. Review before publishing.",
  "Ship 1: FF-gated for ADMIN. Ship 2: enable for MEMBER read-only. Ship 3: full GA + remove FF.",
  "Folds materialise state idempotently from the event log; reactors fire side-effects (CH inserts, alerts) once per event.",
];

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { days: 30, rows: 150 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--personal-project") out.personalProject = argv[++i];
    else if (argv[i] === "--virtual-key") out.virtualKey = argv[++i];
    else if (argv[i] === "--budget") out.budget = argv[++i];
    else if (argv[i] === "--days") out.days = Number(argv[++i]);
    else if (argv[i] === "--rows") out.rows = Number(argv[++i]);
  }
  if (!out.personalProject) throw new Error("--personal-project is required");
  if (!out.virtualKey) throw new Error("--virtual-key is required");
  return out as Args;
}

function pickModel(): ModelMix {
  const r = Math.random();
  let cum = 0;
  for (const m of MODELS) {
    cum += m.weight;
    if (r <= cum) return m;
  }
  return MODELS[0]!;
}

function rand(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

function hex(n: number): string {
  return randomBytes(n).toString("hex");
}

interface SyntheticTrace {
  traceId: string;
  occurredAtMs: number;
  model: ModelMix;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  durationMs: number;
  promptText: string;
  outputText: string;
  gatewayRequestId: string;
}

/**
 * Curve: more activity in the recent week, sparser at the start.
 * Picks an offset days-ago weighted toward 0 (today). Weekday/weekend
 * shape is layered on top: weekend (Sat/Sun) draws are decimated by
 * 60% to give the demo chart realistic peaks.
 */
function pickDaysAgo(maxDays: number): number {
  while (true) {
    const r = Math.random();
    const days = Math.floor(maxDays * Math.pow(r, 1.6));
    const candidate = new Date();
    candidate.setUTCDate(candidate.getUTCDate() - days);
    const dow = candidate.getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    if (!isWeekend || Math.random() < 0.4) return days;
  }
}

function synthTrace(args: Args): SyntheticTrace {
  const model = pickModel();
  const promptTokens = rand(model.promptRange[0], model.promptRange[1]);
  const completionTokens = rand(
    model.completionRange[0],
    model.completionRange[1],
  );
  const costUsd =
    promptTokens * model.costPerInputToken +
    completionTokens * model.costPerOutputToken;
  const durationMs = rand(400, 6000);
  const daysAgo = pickDaysAgo(args.days);
  const hour = rand(0, 24);
  const minute = rand(0, 60);
  const second = rand(0, 60);
  const occurredAt = new Date();
  occurredAt.setUTCDate(occurredAt.getUTCDate() - daysAgo);
  occurredAt.setUTCHours(hour, minute, second, rand(0, 1000));
  const i = rand(0, SAMPLE_PROMPTS.length);
  return {
    traceId: hex(16),
    occurredAtMs: occurredAt.getTime(),
    model,
    promptTokens,
    completionTokens,
    costUsd,
    durationMs,
    promptText: JSON.stringify([
      { role: "user", content: SAMPLE_PROMPTS[i] ?? SAMPLE_PROMPTS[0] },
    ]),
    outputText: SAMPLE_OUTPUTS[i] ?? SAMPLE_OUTPUTS[0]!,
    gatewayRequestId: `req_${hex(15)}`,
  };
}

/**
 * Run the heavy-usage seed for one (project, vk, budget?) tuple.
 * Caller (CLI bootstrap or SeedAction wrapper) is responsible for
 * resolving inputs.
 */
export async function runSeedHeavyUsage(args: Args): Promise<SeedHeavyUsageSummary> {
  process.stderr.write(
    `[seed-heavy-usage] tenant=${args.personalProject} vk=${args.virtualKey} budget=${args.budget ?? "(none)"} window=${args.days}d rows=${args.rows}\n`,
  );

  const traces: SyntheticTrace[] = [];
  for (let i = 0; i < args.rows; i++) traces.push(synthTrace(args));

  const client = await getClickHouseClientForProject(args.personalProject);
  if (!client) throw new Error("ClickHouse client unavailable for tenant");

  const traceRows = traces.map((t) => ({
    ProjectionId: "trace_summary_v1",
    TenantId: args.personalProject,
    TraceId: t.traceId,
    Version: "v1",
    Attributes: {
      "langwatch.virtual_key_id": args.virtualKey,
      "langwatch.gateway_request_id": t.gatewayRequestId,
    },
    OccurredAt: t.occurredAtMs,
    CreatedAt: t.occurredAtMs,
    UpdatedAt: t.occurredAtMs,
    ComputedIOSchemaVersion: "v1",
    ComputedInput: t.promptText,
    ComputedOutput: t.outputText,
    TimeToFirstTokenMs: rand(50, 800),
    TimeToLastTokenMs: t.durationMs,
    TotalDurationMs: t.durationMs,
    TokensPerSecond:
      t.durationMs > 0
        ? Math.round(((t.promptTokens + t.completionTokens) * 1000) / t.durationMs)
        : 0,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: [t.model.name],
    TotalCost: t.costUsd,
    TokensEstimated: false,
    TotalPromptTokenCount: t.promptTokens,
    TotalCompletionTokenCount: t.completionTokens,
    OutputFromRootSpan: true,
    OutputSpanEndTimeMs: t.occurredAtMs + t.durationMs,
    BlockedByGuardrail: false,
    SatisfactionScore: null,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
    ScenarioRoleCosts: {},
    ScenarioRoleLatencies: {},
    ScenarioRoleSpans: {},
    SpanCosts: {},
    AnnotationIds: [],
    LastEventOccurredAt: t.occurredAtMs,
    TraceName: "chat.completion",
    "Events.SpanId": [],
    "Events.Timestamp": [],
    "Events.Name": [],
    "Events.Attributes": [],
    RootSpanType: "llm",
    ContainsAi: true,
    ContainsPrompt: false,
    SelectedPromptId: null,
    SelectedPromptSpanId: null,
    LastUsedPromptId: null,
    LastUsedPromptVersionNumber: null,
    LastUsedPromptVersionId: null,
    LastUsedPromptSpanId: null,
    SourceType: "gateway",
    SourceId: "",
  }));

  process.stderr.write(
    `[seed-heavy-usage] inserting ${traceRows.length} trace_summaries rows\n`,
  );
  await client.insert({
    table: "trace_summaries",
    values: traceRows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
  });

  const budgetId = args.budget;
  if (budgetId !== undefined) {
    const ledgerRows = traces.map((t) => ({
      TenantId: args.personalProject,
      BudgetId: budgetId,
      Scope: "principal",
      ScopeId: args.virtualKey,
      Window: "MONTH",
      VirtualKeyId: args.virtualKey,
      ProviderCredentialId: "",
      GatewayRequestId: t.gatewayRequestId,
      AmountUSD: t.costUsd.toFixed(10),
      TokensInput: t.promptTokens,
      TokensOutput: t.completionTokens,
      TokensCacheRead: 0,
      TokensCacheWrite: 0,
      Model: t.model.name,
      ProviderSlot: "",
      DurationMS: t.durationMs,
      Status: "success",
      OccurredAt: t.occurredAtMs,
      EventTimestamp: Date.now(),
    }));

    process.stderr.write(
      `[seed-heavy-usage] inserting ${ledgerRows.length} gateway_budget_ledger_events rows\n`,
    );
    await client.insert({
      table: "gateway_budget_ledger_events",
      values: ledgerRows,
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
  } else {
    process.stderr.write(
      `[seed-heavy-usage] skipping gateway_budget_ledger_events (no --budget supplied)\n`,
    );
  }

  // Summary stats for the operator.
  const totalCost = traces.reduce((s, t) => s + t.costUsd, 0);
  const byModel = new Map<string, { rows: number; cost: number }>();
  for (const t of traces) {
    const e = byModel.get(t.model.name) ?? { rows: 0, cost: 0 };
    e.rows += 1;
    e.cost += t.costUsd;
    byModel.set(t.model.name, e);
  }
  const summary: SeedHeavyUsageSummary = {
    tenantId: args.personalProject,
    rowsInserted: traces.length,
    totalCostUsd: Number(totalCost.toFixed(6)),
    spanDays: args.days,
    budgetSeeded: budgetId !== undefined,
    byModel: Object.fromEntries(
      [...byModel.entries()].map(([k, v]) => [
        k,
        { rows: v.rows, costUsd: Number(v.cost.toFixed(6)) },
      ]),
    ),
  };
  process.stdout.write(JSON.stringify(summary) + "\n");
  return summary;
}

// CLI bootstrap — only fires when this file is the entry point.
const isCliInvocation =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (isCliInvocation) {
  const args = parseArgs(process.argv.slice(2));
  runSeedHeavyUsage(args)
    .catch((err) => {
      process.stderr.write(
        `[seed-heavy-usage] ERROR: ${err.message}\n${err.stack}\n`,
      );
      process.exit(1);
    })
    .finally(() => {
      setTimeout(() => process.exit(0), 250);
    });
}
