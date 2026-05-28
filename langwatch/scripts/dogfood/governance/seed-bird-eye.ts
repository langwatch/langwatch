/**
 * Bird's-eye admin dashboard fixture seed.
 *
 * Backs the populated capture of `/settings/governance` (the org-admin
 * overview): SpendByTeam rollup, SpendByUser top-N, IngestionSource
 * health strip, and recent anomalies. Without this fixture the page
 * renders the setup checklist (the empty-state path) — which is the
 * regression rchaves caught.
 *
 * Strategy: write `trace_summaries` rows under the org's hidden
 * Governance Project tenancy (same TenantId every governance read uses)
 * with the full set of governance attributes the admin queries filter
 * on:
 *
 *   - TenantId           = hidden internal_governance Project ID
 *   - langwatch.origin.kind         = "ingestion_source"
 *   - langwatch.ingestion_source.id = <IngestionSource.id> (rotated)
 *   - langwatch.user.email          = <persona email> (for SpendByUser)
 *
 * Plus 2-3 IngestionSources distributed across 2-3 teams (so the
 * SpendByTeam rollup actually has a per-team breakdown), and an
 * optional AnomalyAlert seed so "Recent anomalies" isn't empty.
 *
 * Time distribution: rows span `2 * --days`, but each team gets a
 * distinct power-curve skew so the spend-over-time chart shows real
 * variance instead of every team sharing the same +86% shape:
 *
 *   - Customer Support — moderate growth (~+86% recent vs prior)
 *   - Engineering      — flat (~0% — already-saturated team)
 *   - Marketing        — explosive (~+200% — newly onboarded)
 *   - Org-wide         — declining (~−67% — usage winding down)
 *
 * The prior-window mass is what makes `windowOverPreviousPct` /
 * `deltaPctVsPriorWindow` produce realistic deltas instead of
 * `+100%-from-zero` artifacts. `--days N` keeps the dashboard window
 * unchanged; the seed quietly fills 2*N days underneath.
 *
 * Usage (from langwatch/ workspace, app container running):
 *   docker exec wise-mixing-zebra-app-1 sh -c \
 *     'cd /app && pnpm tsx scripts/dogfood/governance/seed-bird-eye.ts \
 *        --org <organizationId> [--days 30] [--rows 240]'
 */
import { randomBytes } from "crypto";

import { prisma } from "~/server/db";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { ensureHiddenGovernanceProject } from "../../../ee/governance/services/governanceProject.service";

interface Args {
  organizationId: string;
  days: number;
  rows: number;
  withAnomaly: boolean;
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
    name: "gpt-5-mini",
    costPerInputToken: 0.00000025,
    costPerOutputToken: 0.000002,
    weight: 0.45,
    promptRange: [12, 800],
    completionRange: [10, 600],
  },
  {
    name: "claude-sonnet-4-6",
    costPerInputToken: 0.000003,
    costPerOutputToken: 0.000015,
    weight: 0.35,
    promptRange: [50, 2000],
    completionRange: [80, 1800],
  },
  {
    name: "gpt-4o-mini",
    costPerInputToken: 0.00000015,
    costPerOutputToken: 0.0000006,
    weight: 0.20,
    promptRange: [20, 1500],
    completionRange: [10, 1200],
  },
];

const PERSONAS = [
  "alice@acme.test",
  "bob@acme.test",
  "carol@acme.test",
  "dave@acme.test",
  "eve@acme.test",
];

function parseArgs(argv: string[]): Args {
  // 480 rows distributed across 2 * days (see pickDaysAgo): the recent
  // half captures ~65% (~310 rows) — comparable density to the old
  // 240-rows-over-1-window default — and the prior half captures ~35%
  // for trend baselines. `--rows N` still overrides for sparse/dense
  // captures.
  const out: Partial<Args> = { days: 30, rows: 480, withAnomaly: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--org") out.organizationId = argv[++i];
    else if (argv[i] === "--days") out.days = Number(argv[++i]);
    else if (argv[i] === "--rows") out.rows = Number(argv[++i]);
    else if (argv[i] === "--no-anomaly") out.withAnomaly = false;
  }
  if (!out.organizationId) throw new Error("--org <organizationId> is required");
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

function pickDaysAgo(maxDays: number, recentSkew: number): number {
  // Distribute over 2 * maxDays with a power-curve skew. The dashboard
  // window is `maxDays` (the most-recent maxDays), so events landing in
  // [maxDays, 2*maxDays) form the prior-window baseline that
  // `windowOverPreviousPct` / `deltaPctVsPriorWindow` compare against.
  //
  // `recentSkew` controls the recent-vs-prior split:
  //   - 1.0 → uniform across the full range (~50% recent, flat trend, ~0%)
  //   - 1.6 → 65% recent / 35% prior (~+86% delta — moderately growing)
  //   - 2.4 → 75% recent / 25% prior (~+200% delta — explosive growth)
  //   - 0.5 → 25% recent / 75% prior (~−67% delta — declining usage)
  //
  // Per-source skew (see SOURCE_TIME_SKEWS) gives each department a
  // distinct visual story on the spend-over-time chart instead of every
  // team sharing the same uniform +86% shape.
  const r = Math.random();
  return Math.floor(2 * maxDays * Math.pow(r, recentSkew));
}

/**
 * Per-source recent-skew exponent for `pickDaysAgo`. Index aligns with
 * the source list emitted by `ensureSourcesAcrossTeams`:
 *   [0] Customer Support — moderate growth (~+86% delta)
 *   [1] Engineering      — flat (~0% delta — already-saturated team)
 *   [2] Marketing        — explosive (~+200% — newly onboarded team)
 *   [3] Org-wide         — declining (~−67% — usage winding down /
 *                          legacy ingestion source)
 *
 * The 4-distinct-story shape makes the bird's-eye spend-over-time chart
 * visibly differentiated (one growing fast, one flat, one explosive,
 * one declining) instead of every series sharing the same growth curve.
 * Falls back to 1.6 (moderate growth) for any out-of-range index.
 */
const SOURCE_TIME_SKEWS = [1.6, 1.0, 2.4, 0.5];

/**
 * Find-or-create the named Team row this seed needs to roll up under.
 * Slug is deterministic per (org, team-name) so re-runs are idempotent
 * and won't collide with other orgs' seed runs.
 *
 * Important: the bird's-eye `SpendByTeam` query rolls up by
 * `IngestionSource.teamId → Team.name`, so the Team ROW must exist for
 * the team-name to render in the dashboard. Re-using whatever existing
 * teams the org already had ("Default Team", "P3 Member Dogfood's
 * Workspace", etc.) makes the capture look monolithic — the whole point
 * of this seed is to demonstrate the cross-team rollup.
 */
async function ensureSeedTeam({
  organizationId,
  orgSlugSuffix,
  name,
  shortKey,
}: {
  organizationId: string;
  orgSlugSuffix: string;
  name: string;
  shortKey: string;
}): Promise<{ id: string; name: string }> {
  const slug = `birdseye-${shortKey}-${orgSlugSuffix}`;
  // `findFirst` (not `findUnique`) so the multitenancy middleware sees
  // organizationId in the WHERE clause — every org-scoped Prisma query
  // must filter by org per `dbOrganizationIdProtection.ts`. Slug is
  // already globally unique (`@unique` in schema) so narrowing by both
  // fields still resolves at most one row, no behavior delta.
  const existing = await prisma.team.findFirst({
    where: { slug, organizationId },
  });
  if (existing) {
    return { id: existing.id, name: existing.name };
  }
  const created = await prisma.team.create({
    data: {
      name,
      slug,
      organizationId,
    },
  });
  return { id: created.id, name: created.name };
}

async function ensureSourcesAcrossTeams({
  organizationId,
  govProjectId,
}: {
  organizationId: string;
  govProjectId: string;
}): Promise<{ id: string; teamId: string | null; teamName: string }[]> {
  // Deterministic slug suffix per org so re-running the seed picks up
  // the same Team rows + IngestionSource rows without duplicating.
  // Last 8 chars of the org id keeps slugs short while staying unique
  // in practice (nanoid is 21 chars; the tail is high-entropy).
  const orgSlugSuffix = organizationId.slice(-8).toLowerCase();

  const teamSpecs = [
    { name: "Customer Support", shortKey: "customer-support" },
    { name: "Engineering", shortKey: "engineering" },
    { name: "Marketing", shortKey: "marketing" },
  ];
  const teams: { id: string; name: string }[] = [];
  for (const spec of teamSpecs) {
    const team = await ensureSeedTeam({
      organizationId,
      orgSlugSuffix,
      name: spec.name,
      shortKey: spec.shortKey,
    });
    teams.push(team);
  }

  const sources: { id: string; teamId: string | null; teamName: string }[] = [];
  for (const team of teams) {
    const sourceName = `Bird's-eye ${team.name} (seed)`;
    const existing = await prisma.ingestionSource.findFirst({
      where: { organizationId, name: sourceName },
    });
    if (existing) {
      // Re-bind to the seed team in case a prior buggy run created the
      // source against a different team — idempotent + self-healing.
      if (existing.teamId !== team.id) {
        await prisma.ingestionSource.update({
          where: { id: existing.id },
          data: { teamId: team.id },
        });
      }
      sources.push({ id: existing.id, teamId: team.id, teamName: team.name });
      continue;
    }
    const created = await prisma.ingestionSource.create({
      data: {
        organizationId,
        teamId: team.id,
        sourceType: "otel_generic",
        name: sourceName,
        ingestSecretHash: hex(20),
        status: "active",
        lastEventAt: new Date(),
      },
    });
    sources.push({ id: created.id, teamId: team.id, teamName: team.name });
  }

  // Plus one team-less ("Org-wide") source so the "Org-wide" bucket
  // renders in the team rollup — covers the contract path the
  // SpendByTeamSection renderer special-cases.
  const orgWideName = "Bird's-eye Org-wide (seed)";
  const orgWide = await prisma.ingestionSource.findFirst({
    where: { organizationId, name: orgWideName },
  });
  if (!orgWide) {
    const created = await prisma.ingestionSource.create({
      data: {
        organizationId,
        teamId: null,
        sourceType: "otel_generic",
        name: orgWideName,
        ingestSecretHash: hex(20),
        status: "active",
        lastEventAt: new Date(),
      },
    });
    sources.push({ id: created.id, teamId: null, teamName: "Org-wide" });
  } else {
    // Self-heal team-bind for the org-wide source too — earlier runs
    // may have left a non-null teamId here.
    if (orgWide.teamId !== null) {
      await prisma.ingestionSource.update({
        where: { id: orgWide.id },
        data: { teamId: null },
      });
    }
    sources.push({ id: orgWide.id, teamId: null, teamName: "Org-wide" });
  }

  console.log(
    `[seed-bird-eye] sources: ${sources
      .map((s) => `${s.id}(${s.teamName})`)
      .join(", ")}`,
  );
  void govProjectId;
  return sources;
}

async function seedTraceSummaries({
  govProjectId,
  sources,
  args,
}: {
  govProjectId: string;
  sources: { id: string; teamId: string | null; teamName: string }[];
  args: Args;
}): Promise<{ totalCostUsd: number; rowsInserted: number }> {
  const ch = await getClickHouseClientForProject(govProjectId);
  if (!ch) throw new Error("ClickHouse client unavailable for governance tenant");

  const traceRows: Record<string, unknown>[] = [];
  let totalCostUsd = 0;

  for (let i = 0; i < args.rows; i++) {
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
    // Skew distribution: source 0 (Customer Support) dominates so the
    // rollup has a clear winner and a long tail. Persona skew matches.
    const sourceIdx =
      Math.random() < 0.5 ? 0 : 1 + (Math.random() < 0.66 ? 0 : Math.random() < 0.5 ? 1 : 2);
    const source = sources[Math.min(sourceIdx, sources.length - 1)]!;
    // Per-source time skew so each team has a distinct trend shape —
    // see SOURCE_TIME_SKEWS for the per-index rationale.
    const recentSkew =
      SOURCE_TIME_SKEWS[Math.min(sourceIdx, SOURCE_TIME_SKEWS.length - 1)] ??
      1.6;
    const daysAgo = pickDaysAgo(args.days, recentSkew);
    const now = new Date();
    const occurredAt = new Date(now);
    occurredAt.setUTCDate(now.getUTCDate() - daysAgo);
    occurredAt.setUTCHours(rand(0, 24), rand(0, 60), rand(0, 60), 0);
    // Clamp to the past — when daysAgo === 0 the random hour can land in
    // the future, which makes "last active" formatters render negative
    // seconds. Cap occurredAt at now-1s so the display path always sees
    // a positive elapsed time without skewing the curve.
    if (occurredAt.getTime() > now.getTime()) {
      occurredAt.setTime(now.getTime() - 1000);
    }
    const occurredAtMs = occurredAt.getTime();
    const persona = PERSONAS[rand(0, PERSONAS.length)] ?? PERSONAS[0]!;

    totalCostUsd += costUsd;
    traceRows.push({
      ProjectionId: "trace_summary_v1",
      TenantId: govProjectId,
      TraceId: hex(16),
      Version: "v1",
      Attributes: {
        "langwatch.origin.kind": "ingestion_source",
        "langwatch.ingestion_source.id": source.id,
        "langwatch.ingestion_source.source_type": "otel_generic",
        "langwatch.ingestion_source.organization_id": args.organizationId,
        "langwatch.user_id": persona,
      },
      OccurredAt: occurredAtMs,
      CreatedAt: occurredAtMs,
      UpdatedAt: occurredAtMs,
      ComputedIOSchemaVersion: "v1",
      ComputedInput: "",
      ComputedOutput: "",
      TimeToFirstTokenMs: rand(50, 800),
      TimeToLastTokenMs: durationMs,
      TotalDurationMs: durationMs,
      TokensPerSecond:
        durationMs > 0
          ? Math.round(((promptTokens + completionTokens) * 1000) / durationMs)
          : 0,
      SpanCount: 1,
      ContainsErrorStatus: false,
      ContainsOKStatus: true,
      ErrorMessage: null,
      Models: [model.name],
      TotalCost: costUsd,
      TokensEstimated: false,
      TotalPromptTokenCount: promptTokens,
      TotalCompletionTokenCount: completionTokens,
      OutputFromRootSpan: true,
      OutputSpanEndTimeMs: occurredAtMs + durationMs,
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
      LastEventOccurredAt: occurredAtMs,
      TraceName: "ingestion.event",
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
      SourceType: "ingestion_source",
      SourceId: source.id,
    });
  }

  console.log(
    `[seed-bird-eye] inserting ${traceRows.length} trace_summaries rows under tenantId=${govProjectId}`,
  );
  await ch.insert({
    table: "trace_summaries",
    values: traceRows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
  });
  return { totalCostUsd, rowsInserted: traceRows.length };
}

async function maybeSeedAnomalyAlert({
  organizationId,
  withAnomaly,
}: {
  organizationId: string;
  withAnomaly: boolean;
}): Promise<void> {
  if (!withAnomaly) return;
  const alertName = "Bird's-eye spend-spike (seed)";
  // Find or create a host AnomalyRule so the foreign-key reference resolves.
  const rule =
    (await prisma.anomalyRule.findFirst({
      where: { organizationId, name: alertName },
    })) ??
    (await prisma.anomalyRule.create({
      data: {
        organizationId,
        name: alertName,
        ruleType: "spend_spike",
        severity: "warning",
        scope: "organization",
        scopeId: organizationId,
        thresholdConfig: {
          windowSec: 3600,
          ratioVsBaseline: 1.5,
          minBaselineUsd: 0.05,
        },
        status: "active",
      },
    }));

  const now = new Date();
  const triggerWindowStart = new Date(now.getTime() - 60 * 60 * 1000);
  const triggerWindowEnd = now;

  // Re-runnable: if a prior alert exists for this rule + window, force it
  // back to state="open" + refresh detectedAt so the bird-eye `Open
  // anomalies` KPI shows non-zero. Earlier shape silently bailed when ANY
  // alert existed under this ruleName, even if it was acknowledged or
  // resolved, so re-running the seed didn't restore the populated state.
  const existing = await prisma.anomalyAlert.findFirst({
    where: { organizationId, ruleId: rule.id },
    orderBy: { detectedAt: "desc" },
  });

  const detail = {
    ratio: 2.4,
    baselineUsd: 0.6,
    sourceLabel: "Customer Support",
  };

  if (existing) {
    const updated = await prisma.anomalyAlert.update({
      where: { id: existing.id },
      data: {
        state: "open",
        detectedAt: now,
        triggerWindowStart,
        triggerWindowEnd,
        triggerSpendUsd: "1.42",
        triggerEventCount: 87,
        acknowledgedAt: null,
        resolvedAt: null,
        detail,
      },
    });
    console.log(
      `[seed-bird-eye] anomaly alert refreshed id=${updated.id} state=open`,
    );
    return;
  }

  const created = await prisma.anomalyAlert.create({
    data: {
      organizationId,
      ruleId: rule.id,
      ruleName: alertName,
      ruleType: "spend_spike",
      severity: "warning",
      triggerWindowStart,
      triggerWindowEnd,
      triggerSpendUsd: "1.42",
      triggerEventCount: 87,
      detectedAt: now,
      state: "open",
      detail,
    },
  });
  console.log(`[seed-bird-eye] anomaly alert created id=${created.id}`);
}

export interface SeedBirdEyeSummary {
  organizationId: string;
  govProjectId: string;
  rowsInserted: number;
  totalCostUsd: number;
  sources: Array<{ id: string; team: string }>;
}

/**
 * Same orchestration the CLI ran inline before, exposed as a named
 * function so the SeedAction wrapper (and any other in-process caller,
 * e.g., the cron API route running this via runSeedDemo) can invoke it
 * with already-resolved inputs. The exported function does NOT manage
 * the prisma connection lifecycle, the CLI bootstrap below still
 * `prisma.$disconnect()`s on exit when invoked directly.
 */
export async function runSeedBirdEye(args: Args): Promise<SeedBirdEyeSummary> {
  console.log(
    `[seed-bird-eye] org=${args.organizationId} dashboard-window=${args.days}d ` +
      `data-spread=${args.days * 2}d rows=${args.rows}`,
  );

  const govProject = await ensureHiddenGovernanceProject(prisma, args.organizationId);
  console.log(`[seed-bird-eye] hidden Governance Project: id=${govProject.id}`);

  const sources = await ensureSourcesAcrossTeams({
    organizationId: args.organizationId,
    govProjectId: govProject.id,
  });

  const { totalCostUsd, rowsInserted } = await seedTraceSummaries({
    govProjectId: govProject.id,
    sources,
    args,
  });

  await maybeSeedAnomalyAlert({
    organizationId: args.organizationId,
    withAnomaly: args.withAnomaly,
  });

  const summary: SeedBirdEyeSummary = {
    organizationId: args.organizationId,
    govProjectId: govProject.id,
    rowsInserted,
    totalCostUsd: Number(totalCostUsd.toFixed(4)),
    sources: sources.map((s) => ({ id: s.id, team: s.teamName })),
  };
  console.log("[seed-bird-eye] summary:");
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

// CLI bootstrap — only fires when this file is the entry point, not
// when imported by the SeedAction wrapper or the cron API path.
const isCliInvocation =
  typeof process.argv[1] === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (isCliInvocation) {
  const args = parseArgs(process.argv.slice(2));
  runSeedBirdEye(args)
    .catch((err) => {
      console.error(`[seed-bird-eye] ERROR: ${err.message}\n${err.stack}`);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
      setTimeout(() => process.exit(0), 250);
    });
}
