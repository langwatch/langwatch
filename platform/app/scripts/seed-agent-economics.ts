/**
 * Deterministic seed for the "ACME developer world": the coding-agent economics
 * boards (/me space) and the FinOps company boards get real rows behind them.
 *
 * Writes, all keyed by fixed ids so re-runs converge (ReplacingMergeTree /
 * delete-then-insert):
 *   A. ClickHouse  coding_agent_sessions        (main user + 5 peer engineers)
 *   B. ClickHouse  coding_agent_session_events  (per-call facts, bounded)
 *   C. Postgres    GithubPullRequest            (~46 PRs, branch/timestamp join)
 *   D. ClickHouse  finops_usage_ledger          (fiscal-year-to-date company bill;
 *                  T1 owns its migration + the `finops_usage` LWQL view over it)
 *
 * Refuses to run against production, and refuses to write without --yes.
 * Anchor "today" with --today=YYYY-MM-DD so the last 7/30/90 days always have
 * data. --dry-run prints per-target row counts and sanity checks with no
 * connection.
 *
 * Usage:
 *   pnpm --filter @langwatch/web tsx scripts/seed-agent-economics.ts --dry-run
 *   pnpm seed:agent-economics -- --yes
 *   pnpm seed:agent-economics -- --yes --today=2026-09-07 --user-id=<id>
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import { buildFinopsRows, type FinopsRow } from "./seed-lib/agent-economics/finops";
import { buildEntities } from "./seed-lib/agent-economics/world";
import { buildPullRequests, type PrSpec } from "./seed-lib/agent-economics/pull-requests";
import { buildSessions, type Engineer } from "./seed-lib/agent-economics/sessions";
import { DAY_MS, fiscalYearStart, resolveToday, utcDayStart } from "./seed-lib/agent-economics/dates";
import { assertLocalUrl } from "./seed-lib/seed-primitives";

const TENANT_ID = "local-dev-project";
const ORG_ID = "local-dev-organization";
/** The current coding-agent fold projection version (foldProjection.ts). */
const PROJECTION_VERSION = "2026-08-23";
const AGENT_VERSION = "1.0.0";
const HISTORY_DAYS = 120;
const CH_BATCH = 5_000;
/** Plan calibration for the FinOps world — see FinopsConfig. Tuned so the
 * fiscal-year-to-date totals sit near budget-to-date for the three plans. */
const FINOPS_USAGE_SCALE = 0.17;
const FINOPS_DBX_CLOUD_SCALE = 1.6;

interface Args {
  yes: boolean;
  dryRun: boolean;
  todayMs: number;
  userId: string;
  githubLogin: string;
  historyDays: number;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return undefined;
    return hit.includes("=") ? hit.split("=").slice(1).join("=") : "true";
  };
  return {
    yes: get("yes") === "true",
    dryRun: get("dry-run") === "true",
    todayMs: resolveToday(get("today")),
    userId: get("user-id") ?? "local-dev-admin-user",
    githubLogin: get("github-login") ?? "drewdrewthis",
    historyDays: Number(get("history-days") ?? HISTORY_DAYS),
  };
}

/** Five synthetic peers so per-user leaderboards have someone to rank against. */
function peers(): Engineer[] {
  const spec: [string, string][] = [
    ["seed-eng-sarah", "sarahkim"],
    ["seed-eng-tom", "tomokafor"],
    ["seed-eng-priya", "priyanair"],
    ["seed-eng-diego", "diegoramos"],
    ["seed-eng-lena", "lenafischer"],
  ];
  return spec.map(([userId, githubLogin]) => ({ userId, name: userId, githubLogin, isMain: false }));
}

function buildAll(args: Args) {
  const engineers: Engineer[] = [
    { userId: args.userId, name: "You", githubLogin: args.githubLogin, isMain: true },
    ...peers(),
  ];
  const prs = buildPullRequests({
    organizationId: ORG_ID,
    todayMs: args.todayMs,
    mainLogin: args.githubLogin,
    peerLogins: peers().map((p) => p.githubLogin),
  });
  const { sessions, events } = buildSessions({
    tenantId: TENANT_ID,
    version: PROJECTION_VERSION,
    agentVersion: AGENT_VERSION,
    todayMs: args.todayMs,
    historyDays: args.historyDays,
    engineers,
    prs,
  });
  const finops = buildFinopsRows(
    {
      tenantId: TENANT_ID,
      fiscalStartMs: fiscalYearStart(args.todayMs),
      todayMs: args.todayMs,
      updatedAtMs: args.todayMs,
      // Calibrated so the fiscal-year-to-date totals land near the plans
      // (see FinopsConfig): Engineering $240k, Claude Code $84k, Databricks $66k.
      usageScale: FINOPS_USAGE_SCALE,
      dbxCloudScale: FINOPS_DBX_CLOUD_SCALE,
    },
    buildEntities(),
  );
  return { engineers, prs, sessions, events, finops };
}

function sanityChecks(args: Args, data: ReturnType<typeof buildAll>): string[] {
  const lines: string[] = [];
  const sevenAgo = args.todayMs - 7 * DAY_MS;
  const eventsLast7 = data.events.filter((e) => (e.TimeUnixMs as Date).getTime() >= sevenAgo);
  const over450 = eventsLast7.filter((e) => e.EventKind === "model_call" && (e.CacheReadTokens as number) + (e.CacheCreationTokens as number) + (e.InputTokens as number) > 450_000);
  const over450Sessions = new Set(over450.map((e) => e.SessionId));
  const apiErrors = eventsLast7.filter((e) => e.EventKind === "api_error");
  const retryMs = apiErrors.reduce((s, e) => s + (e.RetryDurationMs as number), 0);
  const bigResults = eventsLast7.filter((e) => e.EventKind === "tool_result" && (e.ToolResultBytes as number) > 200_000);
  const readResults = bigResults.filter((e) => e.ToolName === "Read");
  const sessLast7Main = data.sessions.filter(
    (s) => (s.UserId as string) === args.userId && (s.StartedAt as Date).getTime() >= sevenAgo,
  );
  const over600 = sessLast7Main.filter((s) => (s.PeakContextTokens as number) > 600_000);
  const rebuilds = sessLast7Main.reduce((s, r) => s + (r.CacheRebuildCount as number), 0);
  const largestRebuild = Math.max(0, ...sessLast7Main.map((s) => s.LargestCacheRebuildTokens as number));

  // commits by the six most recent weeks (main user)
  const weeks = [0, 0, 0, 0, 0, 0];
  for (const s of data.sessions) {
    if ((s.UserId as string) !== args.userId) continue;
    const wk = Math.floor((utcDayStart(args.todayMs) - utcDayStart((s.StartedAt as Date).getTime())) / (7 * DAY_MS));
    if (wk >= 0 && wk < 6) {
      const idx = 5 - wk;
      weeks[idx] = (weeks[idx] ?? 0) + (s.Commits as number);
    }
  }

  const engFinops = data.finops.filter((r) => r.DepartmentId === "engineering");
  const engCost = engFinops.reduce((s, r) => s + r.Cost, 0);
  const claudeCost = data.finops.filter((r) => r.Tool === "claude-code").reduce((s, r) => s + r.Cost, 0);
  const dbxCost = data.finops.filter((r) => r.Tool === "databricks").reduce((s, r) => s + r.Cost, 0);

  lines.push(`leak rule 2 — sessions >600k ctx (last 7d): ${over600.length} (target 1), peak ${Math.max(0, ...over600.map((s) => s.PeakContextTokens as number))}`);
  lines.push(`leak rule 6 — model calls >450k ctx (last 7d): ${over450.length} in ${over450Sessions.size} sessions (target 141 in 2)`);
  lines.push(`leak rule 5 — api_error events (last 7d): ${apiErrors.length}, retry ${(retryMs / 60000).toFixed(1)} min (target 21 / 6 min)`);
  lines.push(`leak rule 4 — cache rebuilds (last 7d): ${rebuilds} (target 19), largest ${largestRebuild} (target 362000)`);
  lines.push(`leak rule 3 — tool results >200KB (last 7d): ${bigResults.length}, ${readResults.length} Reads (target 9 / 7)`);
  lines.push(`commits by week (six most recent, oldest→newest): [${weeks.join(", ")}] (target [11, 9, 6, 4, 8, 9])`);
  lines.push(`finops — Engineering YTD net cost: $${Math.round(engCost).toLocaleString()} (plan $240,000, ramp)`);
  lines.push(`finops — Claude Code net cost: $${Math.round(claudeCost).toLocaleString()} (plan $84,000)`);
  lines.push(`finops — Databricks Genie net cost: $${Math.round(dbxCost).toLocaleString()} (plan $66,000)`);
  return lines;
}

/** The narrow slice of the ClickHouse client this seed uses. */
interface ChClient {
  insert(args: { table: string; values: unknown[]; format: string }): Promise<unknown>;
  command(args: { query: string }): Promise<unknown>;
}

async function insertClickHouse(client: ChClient, table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CH_BATCH) {
    await client.insert({ table, values: rows.slice(i, i + CH_BATCH), format: "JSONEachRow" });
  }
}

/** The physical FinOps ledger table (T1 owns migration 00091_create_finops_usage;
 * the LWQL view is named `finops_usage`). This CREATE IF NOT EXISTS matches that
 * migration so the seed runs standalone before the migration has been applied. */
const FINOPS_TABLE = "finops_usage_ledger";
const FINOPS_DDL = `CREATE TABLE IF NOT EXISTS ${FINOPS_TABLE} (
 TenantId String CODEC(ZSTD(1)), RowId String CODEC(ZSTD(1)), Day Date CODEC(ZSTD(1)),
 Charge LowCardinality(String) CODEC(ZSTD(1)), Tool LowCardinality(String) CODEC(ZSTD(1)), Provider LowCardinality(String) CODEC(ZSTD(1)),
 Agent LowCardinality(String) CODEC(ZSTD(1)), Model LowCardinality(String) CODEC(ZSTD(1)), PersonId String CODEC(ZSTD(1)), PersonName String CODEC(ZSTD(1)),
 TeamId LowCardinality(String) CODEC(ZSTD(1)), TeamName LowCardinality(String) CODEC(ZSTD(1)), DepartmentId LowCardinality(String) CODEC(ZSTD(1)),
 DepartmentName LowCardinality(String) CODEC(ZSTD(1)), Resource LowCardinality(String) CODEC(ZSTD(1)), KeyId String CODEC(ZSTD(1)),
 Requests UInt64 CODEC(ZSTD(1)), Units Float64 CODEC(ZSTD(1)), Unit LowCardinality(String) CODEC(ZSTD(1)), TokensIn UInt64 CODEC(ZSTD(1)),
 TokensOut UInt64 CODEC(ZSTD(1)), CacheRead UInt64 CODEC(ZSTD(1)), CacheWrite UInt64 CODEC(ZSTD(1)), Errors UInt64 CODEC(ZSTD(1)),
 Cost Float64 CODEC(ZSTD(1)), ListCost Float64 CODEC(ZSTD(1)),
 UpdatedAt DateTime64(3) DEFAULT now64(3) CODEC(Delta(8), ZSTD(1)), \`_retention_days\` UInt16 DEFAULT 308 CODEC(Delta(2), ZSTD(1))
)
ENGINE = ReplacingMergeTree(UpdatedAt)
PARTITION BY toYYYYMM(Day)
ORDER BY (TenantId, Day, RowId)
TTL IF(_retention_days > 0, toDateTime(Day) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192`;

async function writePullRequests(prisma: PrismaClient, prs: PrSpec[]): Promise<void> {
  await prisma.githubPullRequest.deleteMany({ where: { id: { startsWith: `caes-pr-${ORG_ID}-` } } });
  await prisma.githubPullRequest.createMany({
    data: prs.map((p) => ({
      id: p.id,
      organizationId: p.organizationId,
      repositoryHost: p.repositoryHost,
      repositoryFullName: p.repositoryFullName,
      headBranch: p.headBranch,
      prNumber: p.prNumber,
      htmlUrl: p.htmlUrl,
      title: p.title,
      state: p.state,
      isDraft: p.isDraft,
      authorLogin: p.authorLogin,
      prCreatedAt: new Date(p.prCreatedAtMs),
      prClosedAt: p.prClosedAtMs === null ? null : new Date(p.prClosedAtMs),
      prMergedAt: p.prMergedAtMs === null ? null : new Date(p.prMergedAtMs),
      prUpdatedAt: new Date(p.prUpdatedAtMs),
      mappedAt: new Date(p.prCreatedAtMs),
      lastCheckedAt: new Date(p.prUpdatedAtMs),
    })),
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run seed-agent-economics with NODE_ENV=production");
  }

  const data = buildAll(args);
  console.log("🌱 seed-agent-economics — planned rows:");
  console.log(`   coding_agent_sessions:        ${data.sessions.length}`);
  console.log(`   coding_agent_session_events:  ${data.events.length}`);
  console.log(`   GithubPullRequest (postgres): ${data.prs.length}`);
  console.log(`   finops_usage:                 ${data.finops.length}`);
  console.log(`   today anchor: ${new Date(args.todayMs).toISOString().slice(0, 10)}  user: ${args.userId}  login: ${args.githubLogin}`);
  console.log("   sanity checks:");
  for (const line of sanityChecks(args, data)) console.log(`     · ${line}`);

  if (data.events.length > 150_000) {
    console.warn(`⚠ event rows ${data.events.length} exceed the 150k budget`);
  }

  if (args.dryRun) {
    console.log("✅ dry run: no rows written.");
    return;
  }
  if (!args.yes) {
    throw new Error("Refusing to write without --yes (pass --dry-run to preview, --yes to commit)");
  }

  assertLocalUrl("DATABASE_URL", process.env.DATABASE_URL);
  assertLocalUrl("CLICKHOUSE_URL", process.env.CLICKHOUSE_URL);

  // The generated Prisma client and the ClickHouse server layer are loaded only
  // on the write path, so --dry-run and the unit tests need neither generated
  // code nor a datastore.
  const { PrismaClient } = await import("../src/generated/prisma/client");
  const { createPrismaPgAdapter } = await import("../src/server/prismaPgAdapter");
  const { getClickHouseClientForTenant } = await import("../src/server/clickhouse/clickhouseClient");

  const prisma = new PrismaClient({ adapter: createPrismaPgAdapter(process.env.DATABASE_URL ?? "") });
  try {
    await writePullRequests(prisma, data.prs);
    console.log(`✅ postgres: wrote ${data.prs.length} GithubPullRequest rows`);

    const chRaw = await getClickHouseClientForTenant(TENANT_ID);
    if (!chRaw) throw new Error("ClickHouse client is unavailable");
    const ch = chRaw as unknown as ChClient;

    await ch.command({ query: FINOPS_DDL });
    await insertClickHouse(ch, "coding_agent_sessions", data.sessions);
    console.log(`✅ clickhouse: wrote ${data.sessions.length} coding_agent_sessions rows`);
    await insertClickHouse(ch, "coding_agent_session_events", data.events);
    console.log(`✅ clickhouse: wrote ${data.events.length} coding_agent_session_events rows`);
    await insertClickHouse(ch, FINOPS_TABLE, data.finops as unknown as Record<string, unknown>[]);
    console.log(`✅ clickhouse: wrote ${data.finops.length} ${FINOPS_TABLE} rows`);
  } finally {
    await prisma.$disconnect();
  }
  console.log("✅ seed-agent-economics complete.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
