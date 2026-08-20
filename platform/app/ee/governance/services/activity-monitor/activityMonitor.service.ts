// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * ActivityMonitorService - read-side queries powering the /governance
 * admin dashboard.
 *
 * Reads from the unified trace store (the same `trace_summaries` +
 * `stored_log_records` tables every other LangWatch surface uses) filtered by
 * `Attributes['langwatch.origin.kind'] = "ingestion_source"`. The receiver
 * (platform/app/src/server/routes/ingest/ingestionRoutes.ts) stamps that marker
 * on every span/log record; trace-attribute-accumulation hoists it from
 * stored_spans into trace_summaries.Attributes so the rollup queries here
 * don't need to scan span-level data.
 *
 * Tenancy: every query filters by `TenantId = govProjectId` where
 * `govProjectId` is the org's hidden internal_governance Project (lazily
 * minted by `ensureHiddenGovernanceProject`). When the org has no Gov
 * Project yet (no IngestionSource has ever been minted), the queries
 * short-circuit to empty results.
 *
 * Anomaly counts (`openAnomalyCount` / `anomalyBreakdown`) read from
 * `prisma.anomalyAlert` - unaffected by the trace-store path.
 *
 * ClickHouse queries live in `activityMonitor.clickhouse.repository.ts`;
 * this file is orchestration (PG joins, department rollup, time-series
 * bucketing) and the public API surface.
 *
 * Spec contracts:
 *   - specs/ai-gateway/governance/folds.feature
 *     (governance fold projection on trace_summaries / log_records)
 *   - specs/ai-gateway/governance/architecture-invariants.feature
 *     (single trace store, reserved namespaces)
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { z } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";

import { tryGetApp } from "~/server/app-layer/app";
import {
  nanoUsdToDecimalString,
  usdToNanoUsd,
} from "~/server/gateway/wireMoney";
import {
  resolveTraceDepartmentId,
  UNASSIGNED_DEPARTMENT,
} from "../department/departmentAttribution";
import { PROJECT_KIND } from "../governanceProject.service";
import {
  ActivityMonitorClickHouseRepository,
  type PulledEventChRow,
  type PushedEventChRow,
  type WindowCountChRow,
} from "./activityMonitor.clickhouse.repository";

// Re-export shared types so existing consumers (router, tests) don't break.
export type {
  SortDir,
  SpendOverTimeGroupBy,
  SpendSortField,
} from "./activityMonitor.clickhouse.repository";

import type {
  SortDir,
  SpendOverTimeGroupBy,
  SpendSortField,
} from "./activityMonitor.clickhouse.repository";

// ---------------------------------------------------------------------------
// Public interfaces — the service's API contract
// ---------------------------------------------------------------------------

export interface SummaryResult {
  spentThisWindowUsd: number;
  windowOverPreviousPct: number;
  /**
   * False when the previous-window spend was zero (no baseline data
   * to compare against). UI mutes the trend subline rather than
   * rendering '↑ 100% vs previous' on every brand-new org. Same
   * semantics as `SpendByTeamRow.hasPriorBaseline`.
   */
  hasPriorBaseline: boolean;
  activeUsersThisWindow: number;
  newUsersThisWindow: number;
  openAnomalyCount: number;
  anomalyBreakdown: { critical: number; warning: number; info: number };
}

export interface SpendByUserRow {
  actor: string;
  spendUsd: string;
  requests: number;
  lastActivityIso: string;
  trendVsPreviousPct: number;
  /**
   * False when the previous-window spend was zero (no baseline data).
   * UI mutes the trend cell rather than rendering a misleading
   * percentage on first-window users. Currently always `false` until
   * the per-user prior-window CTE lands (paired with `trendVsPreviousPct`,
   * which still hard-zeros today).
   */
  hasPriorBaseline: boolean;
  mostUsedTarget: string | null;
}

export interface SpendByTeamRow {
  /** Team.id, or null for sources that aren't team-scoped (org-wide). */
  teamId: string | null;
  /** Team.name, or "Org-wide" for non-team-scoped sources. */
  teamName: string;
  spendUsd: string;
  requestCount: number;
  /**
   * Spend change vs the previous equal-length window (e.g. last 30
   * days vs the 30 days before that). 0 when previous window had no
   * spend AND current is also empty; 100 when previous was zero and
   * current is non-zero (matches `summary.windowOverPreviousPct`).
   * UI should consult `hasPriorBaseline` before rendering this as a
   * percentage - `100` is overloaded (real doubling vs zero-baseline
   * artifact).
   */
  deltaPctVsPriorWindow: number;
  /**
   * False when the previous-window spend was zero (no baseline data
   * to compare against). UI mutes the trend cell to '-' rather than
   * showing a misleading +100% on every brand-new team.
   */
  hasPriorBaseline: boolean;
  lastActivityIso: string | null;
  /** Number of distinct ingestion sources rolled up under this team. */
  sourceCount: number;
}

export interface SpendByDepartmentRow {
  /** Department.id, or null for the synthetic "Unassigned" bucket. */
  departmentId: string | null;
  /** Department.name, or "Unassigned". */
  departmentName: string;
  spendUsd: string;
  requestCount: number;
  lastActivityIso: string | null;
}

export interface IngestionSourceHealthRow {
  id: string;
  name: string;
  sourceType: string;
  status: string;
  lastEventIso: string | null;
  eventsLast24h: number;
}

/** One bucket-major entry in the spend-over-time time series. */
export interface SpendOverTimeBucket {
  /** Day-aligned ISO timestamp (UTC midnight). */
  bucketIso: string;
  /**
   * One point per group-key with non-zero spend in this bucket. Empty
   * array when nothing spent on this day across any group; the bucket
   * is still emitted so the chart's X axis has no gaps.
   */
  points: Array<{
    /**
     * Stable group identifier - teamId, user_id, or model name. Used
     * for color-derivation (name-hash) + click-through scope params.
     */
    key: string;
    /** Human-readable label for legend / tooltip. */
    label: string;
    spendUsd: string;
  }>;
}

export interface SpendOverTimeResult {
  buckets: SpendOverTimeBucket[];
}

export interface ActivityEventDetailRow {
  eventId: string;
  eventType: string;
  actor: string;
  action: string;
  target: string;
  costUsd: string;
  tokensInput: number;
  tokensOutput: number;
  eventTimestampIso: string;
  ingestedAtIso: string;
  rawPayload: string;
}

export interface RecentAnomalyRow {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleType: string;
  severity: "critical" | "warning" | "info";
  triggerWindowStartIso: string;
  triggerWindowEndIso: string;
  triggerSpendUsd: number | null;
  triggerEventCount: number | null;
  detectedAtIso: string;
  state: string;
  currentState: "open" | "acknowledged" | "resolved";
  detail: Record<string, unknown>;
  /** Back-compat alias - same as `ruleName`, used by the iter-10 dashboard renderer. */
  rule: string;
  /** Best-effort source label pulled from `detail` for the dashboard row. */
  sourceLabel: string;
}

export interface SourceHealthMetrics {
  events24h: number;
  events7d: number;
  events30d: number;
  lastSuccessIso: string | null;
}

// ---------------------------------------------------------------------------
// Constants + helpers
// ---------------------------------------------------------------------------

const EMPTY_SUMMARY: SummaryResult = {
  spentThisWindowUsd: 0,
  windowOverPreviousPct: 0,
  hasPriorBaseline: false,
  activeUsersThisWindow: 0,
  newUsersThisWindow: 0,
  openAnomalyCount: 0,
  anomalyBreakdown: { critical: 0, warning: 0, info: 0 },
};

/**
 * Per-row sort key extractors for the in-memory `spendByTeam` ranker.
 * Pagination + sort happen post-aggregation in TS because the team
 * rollup happens after a PG join (CH only sees sourceId, the team
 * mapping is in PG). All keys are numeric so the comparator stays
 * stable regardless of locale.
 */
const TEAM_ROW_SORT_KEYS: Record<
  SpendSortField,
  (row: {
    thisSpendNano: bigint;
    requestCount: number;
    lastActivityMs: number;
  }) => number
> = {
  spend: (r) => Number(r.thisSpendNano),
  requests: (r) => r.requestCount,
  lastActivity: (r) => r.lastActivityMs,
};

function pctChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
}

function extractSourceLabel(detail: unknown): string {
  const d = (detail as Record<string, unknown>) ?? {};
  if (typeof d.sourceLabel === "string") return d.sourceLabel;
  if (typeof d.source === "string") return d.source;
  return "";
}

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    0,
    0,
    0,
    0,
  );
}

/**
 * The usage numbers carried on a stored pulled OCSF row's
 * `metadata.extension`.
 *
 * Parsed rather than cast because the extension object is only partly ours.
 * `mapToOcsfRow` writes these three fields and then spreads the adapter's
 * `extra` over them, and `extra` is typed `z.record(z.unknown())` — so an
 * adapter can land a string, an object, or nothing at all where a number
 * belongs. A bare `Number(...)` turns each of those into `NaN` and puts it on
 * the dashboard. Each field catches independently so one bad value does not
 * zero the other two, and the object catches so a non-object extension is a 0
 * rather than a throw.
 *
 * Deliberately NOT `.nonnegative()`. This reads the stored OCSF row, which is
 * the audit record, and a view of an audit record must not quietly disagree
 * with it: the generic HTTP and S3 pollers resolve `cost_usd` from a
 * customer-configured JSONPath and carry a credit or adjustment line through
 * verbatim, so a negative here is a figure someone actually reported, not
 * corruption. Rendering it as 0 would hide money that the row plainly
 * contains. Only unrepresentable values — `NaN`, `Infinity`, a string, an
 * object — collapse to 0, because those have no figure to show.
 */
const ZERO_PULLED_USAGE = {
  cost_usd: "0",
  tokens_input: 0,
  tokens_output: 0,
};

const pulledUsageExtensionSchema = z
  .object({
    cost_usd: z
      .union([z.string(), z.number()])
      .transform((v) => {
        const s = String(v).trim();
        return s !== "" && Number.isFinite(Number(s)) ? s : "0";
      })
      .catch("0"),
    tokens_input: z.coerce.number().finite().catch(0),
    tokens_output: z.coerce.number().finite().catch(0),
  })
  .catch(ZERO_PULLED_USAGE);

function pulledUsageFromRawOcsf(rawPayload: string): {
  costUsd: string;
  tokensInput: number;
  tokensOutput: number;
} {
  let extension: unknown;
  try {
    extension = (
      JSON.parse(rawPayload) as { metadata?: { extension?: unknown } }
    )?.metadata?.extension;
  } catch {
    extension = null;
  }
  const usage = pulledUsageExtensionSchema.parse(extension ?? {});
  return {
    costUsd: usage.cost_usd,
    tokensInput: usage.tokens_input,
    tokensOutput: usage.tokens_output,
  };
}

// ---------------------------------------------------------------------------
// CH row → service DTO mappers
// ---------------------------------------------------------------------------

function toPushedEvent(row: PushedEventChRow): ActivityEventDetailRow {
  return {
    eventId: row.eventId,
    eventType: row.eventType,
    actor: row.actor,
    action: "trace.recorded",
    target: row.target ?? "",
    costUsd: row.costUsd,
    tokensInput: row.tokensInput,
    tokensOutput: row.tokensOutput,
    eventTimestampIso: new Date(Number(row.occurredMs)).toISOString(),
    ingestedAtIso: new Date(Number(row.createdMs)).toISOString(),
    rawPayload: "",
  };
}

function toPulledEvent(row: PulledEventChRow): ActivityEventDetailRow {
  return {
    eventId: row.eventId,
    eventType: row.eventType,
    actor: row.actorEmail || row.actorUserId || row.actorEnduserId || "",
    action: row.action,
    target: row.target,
    ...pulledUsageFromRawOcsf(row.rawPayload),
    eventTimestampIso: new Date(Number(row.occurredMs)).toISOString(),
    ingestedAtIso: new Date(Number(row.createdMs)).toISOString(),
    rawPayload: row.rawPayload,
  };
}

function emptySourceHealthMetrics(): SourceHealthMetrics {
  return { events24h: 0, events7d: 0, events30d: 0, lastSuccessIso: null };
}

function emptyDenseBuckets(
  windowStartMs: number,
  windowDays: number,
): SpendOverTimeBucket[] {
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets: SpendOverTimeBucket[] = [];
  for (let i = 0; i < windowDays; i++) {
    buckets.push({
      bucketIso: new Date(windowStartMs + i * dayMs).toISOString(),
      points: [],
    });
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

export class ActivityMonitorService {
  private readonly repo = new ActivityMonitorClickHouseRepository();

  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): ActivityMonitorService {
    return new ActivityMonitorService(prisma);
  }

  /**
   * Resolves the org's hidden internal_governance Project ID. Returns null
   * when the org has no Gov Project yet (no IngestionSource has ever been
   * minted) - callers short-circuit to empty results in that case.
   */
  private async resolveGovProjectId(
    organizationId: string,
  ): Promise<string | null> {
    const project = await this.prisma.project.findFirst({
      where: {
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
        team: { organizationId },
        archivedAt: null,
      },
      select: { id: true },
    });
    return project?.id ?? null;
  }

  private async getClickhouse(
    organizationId: string,
  ): Promise<ClickHouseClient | null> {
    const app = tryGetApp();
    if (!app?.clickhouse.enabled) return null;
    return app.clickhouse.resolveOrganizationClient(organizationId);
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------

  async summary(input: {
    organizationId: string;
    windowDays: number;
  }): Promise<SummaryResult> {
    const anomalyBreakdown = await this.openAnomalyBreakdown(
      input.organizationId,
    );
    const openAnomalyCount =
      anomalyBreakdown.critical +
      anomalyBreakdown.warning +
      anomalyBreakdown.info;

    const govProjectId = await this.resolveGovProjectId(input.organizationId);
    if (!govProjectId) {
      return { ...EMPTY_SUMMARY, openAnomalyCount, anomalyBreakdown };
    }

    const ch = await this.getClickhouse(input.organizationId);
    if (!ch) {
      return { ...EMPTY_SUMMARY, openAnomalyCount, anomalyBreakdown };
    }

    const now = Date.now();
    const windowMs = input.windowDays * 24 * 60 * 60 * 1000;
    const thisWindowStart = now - windowMs;
    const previousWindowStart = now - 2 * windowMs;

    const row = await this.repo.findSummarySpend(ch, {
      tenantId: govProjectId,
      thisStart: thisWindowStart,
      prevStart: previousWindowStart,
    });

    return {
      spentThisWindowUsd: row.thisSpend,
      windowOverPreviousPct: pctChange(row.thisSpend, row.prevSpend),
      hasPriorBaseline: row.prevSpend > 0,
      activeUsersThisWindow: row.thisUsers,
      // newUsers requires a baseline-window comparison query which is a
      // follow-up (3b: governance_kpis fold materialises the per-user
      // first-seen). For now the dashboard renders the field but the value
      // is conservative - treat all active as new only when prev=0.
      newUsersThisWindow: row.prevSpend === 0 ? row.thisUsers : 0,
      openAnomalyCount,
      anomalyBreakdown,
    };
  }

  private async openAnomalyBreakdown(
    organizationId: string,
  ): Promise<{ critical: number; warning: number; info: number }> {
    const grouped = await this.prisma.anomalyAlert.groupBy({
      by: ["severity"],
      where: { organizationId, state: "open" },
      _count: { _all: true },
    });
    const breakdown = { critical: 0, warning: 0, info: 0 };
    for (const row of grouped) {
      const sev = row.severity as keyof typeof breakdown;
      if (sev in breakdown) breakdown[sev] = row._count._all;
    }
    return breakdown;
  }

  // -----------------------------------------------------------------------
  // Spend by user
  // -----------------------------------------------------------------------

  async spendByUser(input: {
    organizationId: string;
    windowDays: number;
    limit?: number;
    offset?: number;
    sortBy?: SpendSortField;
    sortDir?: SortDir;
  }): Promise<SpendByUserRow[]> {
    const govProjectId = await this.resolveGovProjectId(input.organizationId);
    if (!govProjectId) return [];

    const ch = await this.getClickhouse(input.organizationId);
    if (!ch) return [];

    const now = Date.now();
    const windowMs = input.windowDays * 24 * 60 * 60 * 1000;

    const rows = await this.repo.findSpendByUser(ch, {
      tenantId: govProjectId,
      windowStart: now - windowMs,
      sortBy: input.sortBy ?? "spend",
      sortDir: input.sortDir ?? "desc",
      limit: input.limit ?? 50,
      offset: Math.max(0, input.offset ?? 0),
    });

    return rows.map((r) => ({
      actor: r.actor,
      spendUsd: r.spendUsdStr,
      requests: Number(r.requests),
      lastActivityIso: new Date(Number(r.lastActivityMs)).toISOString(),
      // Trend-vs-previous needs a windowed CTE comparison; deferred to 3b.
      trendVsPreviousPct: 0,
      hasPriorBaseline: false,
      mostUsedTarget:
        r.mostUsedTarget && r.mostUsedTarget !== "" ? r.mostUsedTarget : null,
    }));
  }

  // -----------------------------------------------------------------------
  // Spend by department
  // -----------------------------------------------------------------------

  /**
   * Spend rolled up by department across EVERY project in the org - the
   * fix for the empty bird's-eye graphs. Unlike `summary`/`spendByUser`,
   * which read only the hidden governance project and the governance
   * ingestion origin, this aggregates the whole org's AI spend so an org
   * with real traffic but no ingestion source still populates.
   *
   * A trace's department is resolved by precedence (principal user → the
   * user's team → the project, else Unassigned), so a person's personal
   * use and the autonomous agents their team runs can land in the same
   * department. The principal user is the `langwatch.user_id` attribute;
   * traces without it (plain application traffic) attribute by project.
   *
   * Tenancy: the project tenant IDs come from Prisma scoped to the org, so
   * the ClickHouse `WHERE TenantId IN (...)` can only ever read this org's
   * own projects - cross-org isolation holds by construction.
   *
   * Spec: specs/ai-gateway/governance/departments.feature
   *       (the @birds-eye scenarios)
   */
  async spendByDepartment(input: {
    organizationId: string;
    windowDays: number;
  }): Promise<SpendByDepartmentRow[]> {
    const projects = await this.prisma.project.findMany({
      where: {
        team: { organizationId: input.organizationId },
        archivedAt: null,
      },
      select: { id: true, departmentId: true },
    });
    if (projects.length === 0) return [];

    const ch = await this.getClickhouse(input.organizationId);
    if (!ch) return [];

    const projectDepartmentById = new Map(
      projects.map((p) => [p.id, p.departmentId] as const),
    );
    const tenantIds = projects.map((p) => p.id);

    const { userDepartmentByEmail, userTeamDepartmentByEmail } =
      await this.resolveUserDepartments(input.organizationId);
    const activeDepartmentNames = await this.activeDepartmentNames(
      input.organizationId,
    );

    const now = Date.now();
    const windowStart = now - input.windowDays * 24 * 60 * 60 * 1000;

    const rows = await this.repo.findSpendByDepartment(ch, {
      tenantIds,
      windowStart,
    });

    const acc = new Map<
      string,
      { spendNanoUsd: bigint; requestCount: number; lastActivityMs: number }
    >();
    for (const r of rows) {
      const hasPrincipalUser = r.actor !== "";
      const departmentId = resolveTraceDepartmentId({
        hasPrincipalUser,
        userDepartmentId: userDepartmentByEmail.get(r.actor),
        userTeamDepartmentId: userTeamDepartmentByEmail.get(r.actor),
        projectDepartmentId: projectDepartmentById.get(r.projectId) ?? null,
      });
      // An archived or otherwise-unknown department rolls up as Unassigned
      // without a backfill: it is simply absent from the active name map.
      const key =
        departmentId !== UNASSIGNED_DEPARTMENT &&
        activeDepartmentNames.has(departmentId)
          ? departmentId
          : UNASSIGNED_DEPARTMENT;
      const prior = acc.get(key) ?? {
        spendNanoUsd: 0n,
        requestCount: 0,
        lastActivityMs: 0,
      };
      acc.set(key, {
        spendNanoUsd: prior.spendNanoUsd + usdToNanoUsd(r.spendUsdStr),
        requestCount: prior.requestCount + Number(r.requests),
        lastActivityMs: Math.max(
          prior.lastActivityMs,
          Number(r.lastActivityMs),
        ),
      });
    }

    return [...acc.entries()]
      .map(([key, v]) => ({
        departmentId: key === UNASSIGNED_DEPARTMENT ? null : key,
        departmentName:
          key === UNASSIGNED_DEPARTMENT
            ? "Unassigned"
            : activeDepartmentNames.get(key)!,
        spendUsd: nanoUsdToDecimalString(v.spendNanoUsd),
        requestCount: v.requestCount,
        lastActivityIso:
          v.lastActivityMs > 0
            ? new Date(v.lastActivityMs).toISOString()
            : null,
      }))
      .sort((a, b) => {
        const aNano = usdToNanoUsd(a.spendUsd);
        const bNano = usdToNanoUsd(b.spendUsd);
        return bNano > aNano ? 1 : bNano < aNano ? -1 : 0;
      });
  }

  private async activeDepartmentNames(
    organizationId: string,
  ): Promise<Map<string, string>> {
    const rows = await this.prisma.department.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name] as const));
  }

  /**
   * Maps a principal user's email (the `langwatch.user_id` attribute) to
   * their own department and, separately, an inherited team department.
   * A member can belong to several teams; the inherited default is the
   * first non-personal team that carries a department.
   */
  private async resolveUserDepartments(organizationId: string): Promise<{
    userDepartmentByEmail: Map<string, string | null>;
    userTeamDepartmentByEmail: Map<string, string | null>;
  }> {
    const members = await this.prisma.organizationUser.findMany({
      where: { organizationId },
      select: {
        departmentId: true,
        user: {
          select: {
            email: true,
            teamMemberships: {
              where: {
                team: {
                  organizationId,
                  isPersonal: false,
                  departmentId: { not: null },
                },
              },
              select: { team: { select: { departmentId: true } } },
            },
          },
        },
      },
    });

    const userDepartmentByEmail = new Map<string, string | null>();
    const userTeamDepartmentByEmail = new Map<string, string | null>();
    for (const m of members) {
      const email = m.user.email;
      if (!email) continue;
      userDepartmentByEmail.set(email, m.departmentId);
      const inherited = m.user.teamMemberships.find(
        (tm) => tm.team.departmentId,
      )?.team.departmentId;
      userTeamDepartmentByEmail.set(email, inherited ?? null);
    }
    return { userDepartmentByEmail, userTeamDepartmentByEmail };
  }

  // -----------------------------------------------------------------------
  // Spend by team
  // -----------------------------------------------------------------------

  /**
   * Per-team spend rollup for the admin governance home - the
   * organization-wide bird's-eye view that complements `spendByUser`
   * (top spenders) with the team breakdown.
   *
   * Implementation: each `IngestionSource` row carries an optional
   * `teamId` (PG schema), and every span/log_record persisted from
   * that source carries the source id in
   * `Attributes['langwatch.ingestion_source.id']`. We aggregate spend
   * + request count per source in ClickHouse, then roll those rows up
   * by team via a PG join. Sources with `teamId = null` aggregate
   * under the "Org-wide" bucket so org-wide ingestion (e.g., a
   * tenant-spanning compliance feed) still surfaces in the dashboard.
   *
   * RBAC: caller is responsible for the org-membership check (the
   * existing `requireEnterprisePlan` + `checkOrganizationPermission`
   * middleware on the tRPC procedure handle that). Service-side
   * defense-in-depth: every CH query filters by `TenantId =
   * govProjectId`, where `govProjectId` is the caller's hidden
   * Governance Project - cross-org leak is structurally impossible.
   */
  async spendByTeam(input: {
    organizationId: string;
    windowDays: number;
    limit?: number;
    offset?: number;
    sortBy?: SpendSortField;
    sortDir?: SortDir;
  }): Promise<SpendByTeamRow[]> {
    const govProjectId = await this.resolveGovProjectId(input.organizationId);
    if (!govProjectId) return [];

    const ch = await this.getClickhouse(input.organizationId);
    if (!ch) return [];

    const now = Date.now();
    const windowMs = input.windowDays * 24 * 60 * 60 * 1000;
    const limit = input.limit ?? 50;
    const offset = Math.max(0, input.offset ?? 0);
    const sortBy = input.sortBy ?? "spend";
    const sortDir = input.sortDir ?? "desc";

    const previousWindowStart = now - 2 * windowMs;

    const sourceRows = await this.repo.findSpendByTeamSource(ch, {
      tenantId: govProjectId,
      thisStart: now - windowMs,
      prevStart: previousWindowStart,
    });
    if (sourceRows.length === 0) return [];

    const sourceIds = sourceRows
      .map((r) => r.sourceId)
      .filter((id) => id !== "");
    const sources = await this.prisma.ingestionSource.findMany({
      where: { id: { in: sourceIds }, organizationId: input.organizationId },
      select: {
        id: true,
        teamId: true,
        team: { select: { id: true, name: true } },
      },
    });
    const teamBySource = new Map(sources.map((s) => [s.id, s.team] as const));

    const ORG_WIDE_KEY = "__org_wide__";
    const byTeam = new Map<
      string,
      {
        teamId: string | null;
        teamName: string;
        thisSpendNano: bigint;
        prevSpendNano: bigint;
        requestCount: number;
        lastActivityMs: number;
        sourceCount: number;
      }
    >();
    for (const row of sourceRows) {
      const team = teamBySource.get(row.sourceId) ?? null;
      const key = team ? team.id : ORG_WIDE_KEY;
      const teamId = team?.id ?? null;
      const teamName = team?.name ?? "Org-wide";
      const thisSpendNano = usdToNanoUsd(row.thisSpendStr);
      const prevSpendNano = usdToNanoUsd(row.prevSpendStr);
      const requestCount = Number(row.thisRequests);
      const lastActivityMs = Number(row.lastActivityMs);
      const existing = byTeam.get(key);
      if (existing) {
        existing.thisSpendNano += thisSpendNano;
        existing.prevSpendNano += prevSpendNano;
        existing.requestCount += requestCount;
        existing.sourceCount += 1;
        existing.lastActivityMs = Math.max(
          existing.lastActivityMs,
          lastActivityMs,
        );
      } else {
        byTeam.set(key, {
          teamId,
          teamName,
          thisSpendNano,
          prevSpendNano,
          requestCount,
          lastActivityMs,
          sourceCount: 1,
        });
      }
    }

    const sortKey = TEAM_ROW_SORT_KEYS[sortBy];
    const sign = sortDir === "asc" ? 1 : -1;
    return [...byTeam.values()]
      .filter((t) => t.thisSpendNano > 0n || t.requestCount > 0)
      .sort((a, b) => sign * (sortKey(a) - sortKey(b)))
      .slice(offset, offset + limit)
      .map((t) => ({
        teamId: t.teamId,
        teamName: t.teamName,
        spendUsd: nanoUsdToDecimalString(t.thisSpendNano),
        requestCount: t.requestCount,
        deltaPctVsPriorWindow: pctChange(
          Number(t.thisSpendNano),
          Number(t.prevSpendNano),
        ),
        hasPriorBaseline: t.prevSpendNano > 0n,
        lastActivityIso:
          t.lastActivityMs > 0
            ? new Date(t.lastActivityMs).toISOString()
            : null,
        sourceCount: t.sourceCount,
      }));
  }

  // -----------------------------------------------------------------------
  // Spend over time
  // -----------------------------------------------------------------------

  /**
   * Time-series spend rollup for the bird's-eye `<SpendOverTimeChart>`.
   * Bucketed daily, grouped by team / user / model. The wire shape is
   * bucket-major (one entry per day with all non-zero groups inside)
   * which round-trips exactly the cross-product the chart legend
   * needs without any client-side reshape gymnastics.
   *
   * Density invariant: `buckets` covers every day in the window, even
   * empty ones - Recharts AreaChart with `stackId="1"` requires a
   * dense X axis or it draws gaps that visually misrepresent quiet
   * days as "missing data". Empty days surface as `points: []`.
   *
   * Tenancy: same as every other read in this service - every CH query
   * filters by `TenantId = govProjectId`. groupBy='team' rolls up
   * IngestionSource rows (CH-side spend) by their teamId via a PG join
   * (Org-wide bucket for null-teamId sources). groupBy='user' /
   * 'model' read the corresponding attribute / Models[1] directly.
   *
   * Spec: specs/ai-gateway/governance/birds-eye-dashboard-v2.feature
   *   §"Spend-over-time stacked-area chart renders by team"
   *   §"spendOverTime API contract"
   *   §"spendOverTime CH query honors TenantId scoping"
   */
  async spendOverTime(input: {
    organizationId: string;
    windowDays: number;
    groupBy: SpendOverTimeGroupBy;
  }): Promise<SpendOverTimeResult> {
    const windowDays = Math.max(1, Math.floor(input.windowDays));
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const todayStart = startOfUtcDay(now);
    const windowStart = todayStart - (windowDays - 1) * dayMs;

    const govProjectId = await this.resolveGovProjectId(input.organizationId);
    if (!govProjectId) {
      return { buckets: emptyDenseBuckets(windowStart, windowDays) };
    }

    const ch = await this.getClickhouse(input.organizationId);
    if (!ch) {
      return { buckets: emptyDenseBuckets(windowStart, windowDays) };
    }

    const rows = await this.repo.findSpendOverTime(ch, {
      tenantId: govProjectId,
      windowStart,
      groupBy: input.groupBy,
    });

    let labelByKey: Map<string, { key: string; label: string }>;
    let rolledRows: Array<{
      bucketMs: number;
      key: string;
      spendNanoUsd: bigint;
    }>;

    if (input.groupBy === "team") {
      const sourceIds = Array.from(
        new Set(
          rows
            .map((r) => r.groupKey)
            .filter((s): s is string => typeof s === "string" && s !== ""),
        ),
      );
      const sources = sourceIds.length
        ? await this.prisma.ingestionSource.findMany({
            where: {
              id: { in: sourceIds },
              organizationId: input.organizationId,
            },
            select: {
              id: true,
              team: { select: { id: true, name: true } },
            },
          })
        : [];
      const teamBySource = new Map(sources.map((s) => [s.id, s.team] as const));
      const ORG_WIDE_KEY = "__org_wide__";
      labelByKey = new Map();
      rolledRows = [];
      for (const row of rows) {
        const sourceId = row.groupKey ?? "";
        if (!sourceId) continue;
        const team = teamBySource.get(sourceId) ?? null;
        const key = team?.id ?? ORG_WIDE_KEY;
        const label = team?.name ?? "Org-wide";
        labelByKey.set(key, { key, label });
        rolledRows.push({
          bucketMs: Number(row.bucketMs),
          key,
          spendNanoUsd: usdToNanoUsd(row.spendUsdStr),
        });
      }
    } else {
      labelByKey = new Map();
      rolledRows = [];
      for (const row of rows) {
        const key = row.groupKey ?? "";
        if (!key) continue;
        labelByKey.set(key, { key, label: key });
        rolledRows.push({
          bucketMs: Number(row.bucketMs),
          key,
          spendNanoUsd: usdToNanoUsd(row.spendUsdStr),
        });
      }
    }

    // Roll up (bucket, key) duplicates that come out of the team-side
    // sourceId → teamId remapping (multiple sources can share one team).
    const aggregated = new Map<string, bigint>();
    for (const r of rolledRows) {
      const k = `${r.bucketMs}::${r.key}`;
      aggregated.set(k, (aggregated.get(k) ?? 0n) + r.spendNanoUsd);
    }

    const buckets = emptyDenseBuckets(windowStart, windowDays);
    const bucketIndexByMs = new Map(
      buckets.map((b, i) => [Date.parse(b.bucketIso), i] as const),
    );
    for (const [composite, spendNanoUsd] of aggregated.entries()) {
      const sep = composite.indexOf("::");
      const bucketMs = Number(composite.slice(0, sep));
      const key = composite.slice(sep + 2);
      const idx = bucketIndexByMs.get(bucketMs);
      if (idx === undefined) continue;
      const meta = labelByKey.get(key);
      if (!meta) continue;
      if (spendNanoUsd <= 0n) continue;
      buckets[idx]!.points.push({
        key: meta.key,
        label: meta.label,
        spendUsd: nanoUsdToDecimalString(spendNanoUsd),
      });
    }

    // Stable per-bucket ordering - descending spend so the largest
    // contributor renders at the bottom of the stacked area (Recharts
    // stacks in array order; bottom-up = largest-first).
    for (const bucket of buckets) {
      bucket.points.sort((a, b) => {
        const aN = usdToNanoUsd(a.spendUsd);
        const bN = usdToNanoUsd(b.spendUsd);
        return bN > aN ? 1 : bN < aN ? -1 : 0;
      });
    }

    return { buckets };
  }

  // -----------------------------------------------------------------------
  // Recent anomalies (Prisma only)
  // -----------------------------------------------------------------------

  /**
   * Recent anomaly alerts produced by the anomaly-detection subscriber.
   * Read-only snapshot of `prisma.anomalyAlert` rows for the org,
   * sorted by detectedAt DESC. Returns `[]` for orgs with no alerts
   * - callers render the empty-state in the dashboard.
   */
  async recentAnomalies(input: {
    organizationId: string;
    limit?: number;
  }): Promise<RecentAnomalyRow[]> {
    const limit = input.limit ?? 50;
    const rows = await this.prisma.anomalyAlert.findMany({
      where: { organizationId: input.organizationId },
      orderBy: { detectedAt: "desc" },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      ruleId: row.ruleId,
      ruleName: row.ruleName,
      ruleType: row.ruleType,
      severity: row.severity as "critical" | "warning" | "info",
      triggerWindowStartIso: row.triggerWindowStart.toISOString(),
      triggerWindowEndIso: row.triggerWindowEnd.toISOString(),
      triggerSpendUsd: row.triggerSpendUsd
        ? Number(row.triggerSpendUsd.toString())
        : null,
      triggerEventCount: row.triggerEventCount,
      detectedAtIso: row.detectedAt.toISOString(),
      state: row.state,
      currentState: row.state as "open" | "acknowledged" | "resolved",
      detail: row.detail as Record<string, unknown>,
      // Back-compat aliases for the existing /governance dashboard
      // (renderer was sketched against the iter-10 mock shape).
      rule: row.ruleName,
      sourceLabel: extractSourceLabel(row.detail),
    }));
  }

  // -----------------------------------------------------------------------
  // Ingestion source health
  // -----------------------------------------------------------------------

  async ingestionSourcesHealth(input: {
    organizationId: string;
  }): Promise<IngestionSourceHealthRow[]> {
    const sources = await this.prisma.ingestionSource.findMany({
      where: { organizationId: input.organizationId, archivedAt: null },
      orderBy: { name: "asc" },
    });
    if (sources.length === 0) return [];

    const govProjectId = await this.resolveGovProjectId(input.organizationId);
    const ch = govProjectId
      ? await this.getClickhouse(input.organizationId)
      : null;

    const eventsBySource = new Map<string, number>();
    if (ch && govProjectId) {
      const sourceIds = sources.map((s) => s.id);
      const since = Date.now() - 24 * 60 * 60 * 1000;
      const counts = await Promise.all([
        this.repo.countTracedEventsBySource(ch, {
          tenantId: govProjectId,
          sourceIds,
          since,
        }),
        this.repo.countLoggedEventsBySource(ch, {
          tenantId: govProjectId,
          sourceIds,
          since,
        }),
        this.repo.countPulledEventsBySource(ch, {
          tenantId: govProjectId,
          sourceIds,
          since,
        }),
      ]);
      for (const row of counts.flat()) {
        eventsBySource.set(
          row.sourceId,
          (eventsBySource.get(row.sourceId) ?? 0) + Number(row.c),
        );
      }
    }

    return sources.map((src) => ({
      id: src.id,
      name: src.name,
      sourceType: src.sourceType,
      status: src.status,
      lastEventIso: src.lastEventAt?.toISOString() ?? null,
      eventsLast24h: eventsBySource.get(src.id) ?? 0,
    }));
  }

  // -----------------------------------------------------------------------
  // Events for source (pushed + pulled, merged)
  // -----------------------------------------------------------------------

  async eventsForSource(input: {
    organizationId: string;
    sourceId: string;
    limit?: number;
    beforeIso?: string;
  }): Promise<ActivityEventDetailRow[]> {
    const govProjectId = await this.resolveGovProjectId(input.organizationId);
    if (!govProjectId) return [];

    const ch = await this.getClickhouse(input.organizationId);
    if (!ch) return [];

    const limit = input.limit ?? 50;
    const beforeMs = input.beforeIso
      ? new Date(input.beforeIso).getTime()
      : Date.now();

    const [pushedEvents, pulledEvents] = await Promise.all([
      this.repo
        .findPushedEventsForSource(ch, {
          tenantId: govProjectId,
          sourceId: input.sourceId,
          beforeMs,
          limit,
        })
        .then((rows) => rows.map(toPushedEvent)),
      this.repo
        .findPulledEventsForSource(ch, {
          tenantId: govProjectId,
          sourceId: input.sourceId,
          beforeMs,
          limit,
        })
        .then((rows) => rows.map(toPulledEvent)),
    ]);

    const seen = new Set<string>();
    return [...pushedEvents, ...pulledEvents]
      .sort(
        (a, b) =>
          new Date(b.eventTimestampIso).getTime() -
            new Date(a.eventTimestampIso).getTime() ||
          b.eventId.localeCompare(a.eventId),
      )
      .filter((event) => {
        if (seen.has(event.eventId)) return false;
        seen.add(event.eventId);
        return true;
      })
      .slice(0, limit);
  }

  // -----------------------------------------------------------------------
  // Source health metrics (24h / 7d / 30d)
  // -----------------------------------------------------------------------

  async sourceHealthMetrics(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<SourceHealthMetrics> {
    const govProjectId = await this.resolveGovProjectId(input.organizationId);
    if (!govProjectId) return emptySourceHealthMetrics();

    const ch = await this.getClickhouse(input.organizationId);
    if (!ch) return emptySourceHealthMetrics();

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const windowParams = {
      tenantId: govProjectId,
      sourceId: input.sourceId,
      since24h: now - day,
      since7d: now - 7 * day,
      since30d: now - 30 * day,
    };

    const windows = await Promise.all([
      this.repo.findTracedEventWindowCounts(ch, windowParams),
      this.repo.findLoggedEventWindowCounts(ch, windowParams),
      this.repo.findPulledEventWindowCounts(ch, windowParams),
    ]);

    const total = (pick: (row: WindowCountChRow) => number) =>
      windows.reduce((sum, row) => sum + (row ? pick(row) : 0), 0);

    const lastMs = Math.max(
      0,
      ...windows.map((row) => (row?.lastMs ? Number(row.lastMs) : 0)),
    );

    return {
      events24h: total((r) => r.c24),
      events7d: total((r) => r.c7),
      events30d: total((r) => r.c30),
      lastSuccessIso: lastMs > 0 ? new Date(lastMs).toISOString() : null,
    };
  }
}
