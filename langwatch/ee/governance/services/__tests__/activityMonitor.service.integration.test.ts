/**
 * ActivityMonitorService — read-side integration tests against the unified
 * trace store.
 *
 * Sergey commit fd118131c (step 3a) shipped the rewire from the deleted
 * `gateway_activity_events` CH table onto trace_summaries +
 * stored_log_records filtered by
 * `Attributes['langwatch.origin.kind'] = 'ingestion_source'`. This test
 * exercises the read queries against real ClickHouse with seeded
 * governance-origin rows.
 *
 * Test isolation strategy: seeds CH directly (no trace pipeline,
 * no async fold delays) so the test stays deterministic under <1s.
 * Andre's d20a1b403 covers the write path (POST → receiver →
 * handleOtlpTraceRequest); this test covers the read path
 * (CH rows → ActivityMonitorService → KPI shape). End-to-end
 * verification of the full ingest→fold→read loop is Lane-B's
 * customer-flow dogfood pass against staging.
 *
 * Spec contracts:
 *   - specs/ai-gateway/governance/folds.feature
 *     (governance fold projections — read-side derivation)
 *   - specs/ai-gateway/governance/architecture-invariants.feature
 *     (single trace store; queries tenanted on hidden Gov Project)
 *
 * Pairs with:
 *   - governanceProject.service.integration.test.ts (helper invariants)
 *   - ingestionRoutes.integration.test.ts (HTTP receiver end-to-end)
 *   - eventLogDurability.integration.test.ts (write path durability)
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { type Organization, type Project } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  PROJECT_KIND,
  ensureHiddenGovernanceProject,
} from "../governanceProject.service";
import { ActivityMonitorService } from "../activity-monitor/activityMonitor.service";

const ORIGIN_KEY = "langwatch.origin.kind";
const ORIGIN_VALUE = "ingestion_source";
const SOURCE_ID_KEY = "langwatch.ingestion_source.id";
const SOURCE_TYPE_KEY = "langwatch.ingestion_source.source_type";
const ORG_ID_KEY = "langwatch.ingestion_source.organization_id";
const RETENTION_KEY = "langwatch.governance.retention_class";
const USER_KEY = "langwatch.user_id";

interface SeedTrace {
  traceId: string;
  occurredAt: Date;
  totalCost: number;
  totalPromptTokenCount: number;
  totalCompletionTokenCount: number;
  models: string[];
  attrs: Record<string, string>;
}

async function insertGovernanceTraceSummary(
  ch: ClickHouseClient,
  tenantId: string,
  trace: SeedTrace,
): Promise<void> {
  await ch.insert({
    table: "trace_summaries",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: trace.traceId,
        Version: "v1",
        Attributes: trace.attrs,
        OccurredAt: trace.occurredAt,
        CreatedAt: trace.occurredAt,
        UpdatedAt: trace.occurredAt,
        ComputedIOSchemaVersion: "",
        ComputedInput: null,
        ComputedOutput: null,
        TimeToFirstTokenMs: null,
        TimeToLastTokenMs: null,
        TotalDurationMs: 100,
        TokensPerSecond: null,
        SpanCount: 1,
        ContainsErrorStatus: 0,
        ContainsOKStatus: 1,
        ErrorMessage: null,
        Models: trace.models,
        TotalCost: trace.totalCost,
        TokensEstimated: false,
        TotalPromptTokenCount: trace.totalPromptTokenCount,
        TotalCompletionTokenCount: trace.totalCompletionTokenCount,
        OutputFromRootSpan: 0,
        OutputSpanEndTimeMs: 0,
        BlockedByGuardrail: 0,
        TopicId: null,
        SubTopicId: null,
        HasAnnotation: null,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

async function insertGovernanceLogRecord(
  ch: ClickHouseClient,
  tenantId: string,
  attrs: Record<string, string>,
  occurredAt: Date,
): Promise<void> {
  await ch.insert({
    table: "stored_log_records",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: `trace-${nanoid()}`,
        SpanId: `span-${nanoid()}`,
        TimeUnixMs: occurredAt,
        SeverityNumber: 9,
        SeverityText: "INFO",
        Body: "{}",
        Attributes: attrs,
        ResourceAttributes: {},
        ScopeName: "test",
        ScopeVersion: null,
        CreatedAt: occurredAt,
        UpdatedAt: occurredAt,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

describe("ActivityMonitorService — read-side queries against unified trace store", () => {
  const namespace = `am-svc-${nanoid(8)}`;
  let ch: ClickHouseClient;
  let primaryOrg: Organization;
  let primaryGovProject: Project;
  let primaryTeamId: string;
  let primarySourceId: string;
  let secondarySourceId: string;
  let crossOrg: Organization;
  let crossGovProject: Project;
  let crossSourceId: string;

  beforeAll(async () => {
    const maybeCh = getTestClickHouseClient();
    if (!maybeCh) {
      throw new Error("ClickHouse test container not available");
    }
    ch = maybeCh;

    primaryOrg = await prisma.organization.create({
      data: {
        name: `Primary Org ${namespace}`,
        slug: `primary-org-${namespace}`,
      },
    });
    const primaryTeam = await prisma.team.create({
      data: {
        name: `Primary Team ${namespace}`,
        slug: `primary-team-${namespace}`,
        organizationId: primaryOrg.id,
      },
    });
    primaryTeamId = primaryTeam.id;
    crossOrg = await prisma.organization.create({
      data: {
        name: `Cross Org ${namespace}`,
        slug: `cross-org-${namespace}`,
      },
    });
    await prisma.team.create({
      data: {
        name: `Cross Team ${namespace}`,
        slug: `cross-team-${namespace}`,
        organizationId: crossOrg.id,
      },
    });

    primaryGovProject = await ensureHiddenGovernanceProject(prisma, primaryOrg.id);
    crossGovProject = await ensureHiddenGovernanceProject(prisma, crossOrg.id);

    primarySourceId = `is-primary-${nanoid()}`;
    secondarySourceId = `is-secondary-${nanoid()}`;
    crossSourceId = `is-cross-${nanoid()}`;

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    // 12h offset (not 24h) so the row stays inside the 24h window even when
    // the test runner adds setup latency between fixture insert and query
    // execution. The 7d/30d window assertions still include this row.
    const inWindow = new Date(now - 12 * 60 * 60 * 1000);
    const outOfWindow = new Date(now - 14 * day);

    // Primary org governance traces — three users, two sources, mixed times
    await insertGovernanceTraceSummary(ch, primaryGovProject.id, {
      traceId: `tr-primary-1-${nanoid()}`,
      occurredAt: inWindow,
      totalCost: 0.5,
      totalPromptTokenCount: 100,
      totalCompletionTokenCount: 50,
      models: ["claude-sonnet-4"],
      attrs: {
        [ORIGIN_KEY]: ORIGIN_VALUE,
        [SOURCE_ID_KEY]: primarySourceId,
        [SOURCE_TYPE_KEY]: "otel_generic",
        [ORG_ID_KEY]: primaryOrg.id,
        [RETENTION_KEY]: "thirty_days",
        [USER_KEY]: "alice@example.com",
      },
    });
    await insertGovernanceTraceSummary(ch, primaryGovProject.id, {
      traceId: `tr-primary-2-${nanoid()}`,
      occurredAt: inWindow,
      totalCost: 1.5,
      totalPromptTokenCount: 200,
      totalCompletionTokenCount: 100,
      models: ["claude-sonnet-4"],
      attrs: {
        [ORIGIN_KEY]: ORIGIN_VALUE,
        [SOURCE_ID_KEY]: primarySourceId,
        [SOURCE_TYPE_KEY]: "otel_generic",
        [ORG_ID_KEY]: primaryOrg.id,
        [RETENTION_KEY]: "thirty_days",
        [USER_KEY]: "bob@example.com",
      },
    });
    await insertGovernanceTraceSummary(ch, primaryGovProject.id, {
      traceId: `tr-primary-3-${nanoid()}`,
      occurredAt: outOfWindow,
      totalCost: 0.25,
      totalPromptTokenCount: 50,
      totalCompletionTokenCount: 25,
      models: ["claude-sonnet-4"],
      attrs: {
        [ORIGIN_KEY]: ORIGIN_VALUE,
        [SOURCE_ID_KEY]: secondarySourceId,
        [SOURCE_TYPE_KEY]: "claude_cowork",
        [ORG_ID_KEY]: primaryOrg.id,
        [RETENTION_KEY]: "thirty_days",
        [USER_KEY]: "carol@example.com",
      },
    });
    // Application trace (NOT governance-origin) — must be excluded by all queries
    await insertGovernanceTraceSummary(ch, primaryGovProject.id, {
      traceId: `tr-primary-app-${nanoid()}`,
      occurredAt: inWindow,
      totalCost: 99,
      totalPromptTokenCount: 9999,
      totalCompletionTokenCount: 9999,
      models: ["app-model"],
      attrs: {
        [USER_KEY]: "should-not-count@example.com",
      },
    });

    // Cross-org governance trace — must be excluded by all primary-org queries
    await insertGovernanceTraceSummary(ch, crossGovProject.id, {
      traceId: `tr-cross-1-${nanoid()}`,
      occurredAt: inWindow,
      totalCost: 50,
      totalPromptTokenCount: 5000,
      totalCompletionTokenCount: 2500,
      models: ["claude-sonnet-4"],
      attrs: {
        [ORIGIN_KEY]: ORIGIN_VALUE,
        [SOURCE_ID_KEY]: crossSourceId,
        [SOURCE_TYPE_KEY]: "otel_generic",
        [ORG_ID_KEY]: crossOrg.id,
        [RETENTION_KEY]: "thirty_days",
        [USER_KEY]: "alice@cross.example.com",
      },
    });

    // Webhook log_record path (governance-origin) for ingestionSourcesHealth
    await insertGovernanceLogRecord(
      ch,
      primaryGovProject.id,
      {
        [ORIGIN_KEY]: ORIGIN_VALUE,
        [SOURCE_ID_KEY]: secondarySourceId,
        [SOURCE_TYPE_KEY]: "claude_cowork",
        [ORG_ID_KEY]: primaryOrg.id,
        [RETENTION_KEY]: "thirty_days",
      },
      inWindow,
    );

    // Persist the IngestionSource rows so ingestionSourcesHealth has metadata
    // to roll up. The PG side is the source of truth for source identity;
    // CH is only the events store.
    await prisma.ingestionSource.createMany({
      data: [
        {
          id: primarySourceId,
          organizationId: primaryOrg.id,
          // Team-scoped — exercises the spendByTeam team-rollup path.
          teamId: primaryTeamId,
          name: "Primary OTel source",
          sourceType: "otel_generic",
          status: "active",
          ingestSecretHash: "test",
          parserConfig: {},
          retentionClass: "thirty_days",
        },
        {
          id: secondarySourceId,
          organizationId: primaryOrg.id,
          // Null teamId — exercises the spendByTeam "Org-wide" bucket.
          name: "Secondary Cowork source",
          sourceType: "claude_cowork",
          status: "active",
          ingestSecretHash: "test",
          parserConfig: {},
          retentionClass: "thirty_days",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.ingestionSource
      .deleteMany({
        where: { organizationId: { in: [primaryOrg.id, crossOrg.id] } },
      })
      .catch(() => undefined);
    await prisma.project
      .deleteMany({
        where: {
          id: { in: [primaryGovProject.id, crossGovProject.id] },
        },
      })
      .catch(() => undefined);
    await prisma.team
      .deleteMany({
        where: { organizationId: { in: [primaryOrg.id, crossOrg.id] } },
      })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: { in: [primaryOrg.id, crossOrg.id] } } })
      .catch(() => undefined);
    await cleanupTestData(primaryGovProject.id);
    await cleanupTestData(crossGovProject.id);
  });

  describe("when an org has no hidden Governance Project (no IngestionSource ever minted)", () => {
    it("returns empty summary without touching ClickHouse", async () => {
      const orphanOrg = await prisma.organization.create({
        data: {
          name: `Orphan Org ${namespace}`,
          slug: `orphan-org-${namespace}`,
        },
      });
      try {
        const service = ActivityMonitorService.create(prisma);
        const summary = await service.summary({
          organizationId: orphanOrg.id,
          windowDays: 7,
        });
        expect(summary.spentThisWindowUsd).toBe(0);
        expect(summary.activeUsersThisWindow).toBe(0);
      } finally {
        await prisma.organization
          .delete({ where: { id: orphanOrg.id } })
          .catch(() => undefined);
      }
    });
  });

  describe("when querying summary() with governance-origin traces seeded", () => {
    it("returns spend rolled up from governance-origin traces in the window", async () => {
      const service = ActivityMonitorService.create(prisma);
      const summary = await service.summary({
        organizationId: primaryOrg.id,
        windowDays: 7,
      });
      // tr-primary-1 ($0.50) + tr-primary-2 ($1.50) = $2.00 in 7d window.
      // tr-primary-3 ($0.25, 14d ago) is out of 7d window.
      // tr-primary-app ($99) is excluded — no governance-origin attrs.
      expect(summary.spentThisWindowUsd).toBeCloseTo(2.0, 2);
    });

    it("rolls up active users from langwatch.user_id in governance traces only", async () => {
      const service = ActivityMonitorService.create(prisma);
      const summary = await service.summary({
        organizationId: primaryOrg.id,
        windowDays: 7,
      });
      // alice + bob in 7d window. carol is in the 14d window (out).
      // should-not-count is in app trace (out).
      expect(summary.activeUsersThisWindow).toBe(2);
    });

    it("excludes cross-org governance traces (TenantId isolation)", async () => {
      const service = ActivityMonitorService.create(prisma);
      const summary = await service.summary({
        organizationId: primaryOrg.id,
        windowDays: 30,
      });
      // 30d window includes tr-primary-3 ($0.25). Should NOT include
      // cross org's tr-cross-1 ($50).
      expect(summary.spentThisWindowUsd).toBeCloseTo(2.25, 2);
    });
  });

  describe("when querying spendByUser()", () => {
    it("returns per-user spend rollup sorted by spend desc", async () => {
      const service = ActivityMonitorService.create(prisma);
      const rows = await service.spendByUser({
        organizationId: primaryOrg.id,
        windowDays: 7,
      });
      expect(rows.length).toBeGreaterThan(0);
      const actors = rows.map((r) => r.actor);
      expect(actors).toContain("alice@example.com");
      expect(actors).toContain("bob@example.com");
      expect(actors).not.toContain("should-not-count@example.com");
      // Bob spent $1.50, alice spent $0.50; bob first
      const bob = rows.find((r) => r.actor === "bob@example.com");
      const alice = rows.find((r) => r.actor === "alice@example.com");
      expect(bob?.spendUsd).toBeCloseTo(1.5, 2);
      expect(alice?.spendUsd).toBeCloseTo(0.5, 2);
      expect(rows[0]?.actor).toBe("bob@example.com");
    });
  });

  describe("when querying spendByTeam()", () => {
    it("rolls up spend by IngestionSource.teamId with an Org-wide bucket for null-teamId sources", async () => {
      const service = ActivityMonitorService.create(prisma);
      // windowDays=15 (not 14) to comfortably include Carol's row at
      // `now - 14 * day` regardless of test-execution latency between
      // fixture insert and query — at exactly windowDays=14 the row
      // is right on the boundary and small clock drift (insert
      // wall-clock vs query wall-clock) flipped it from the current
      // window into the prior window, dropping the Org-wide row from
      // the result entirely.
      const rows = await service.spendByTeam({
        organizationId: primaryOrg.id,
        windowDays: 15,
      });
      expect(rows.length).toBeGreaterThanOrEqual(2);

      const primary = rows.find((r) => r.teamId === primaryTeamId);
      const orgWide = rows.find((r) => r.teamId === null);

      // Primary team source: alice $0.50 + bob $1.50 = $2.00, 2 requests.
      expect(primary).toBeDefined();
      expect(primary?.spendUsd).toBeCloseTo(2.0, 2);
      expect(primary?.requestCount).toBe(2);
      expect(primary?.sourceCount).toBe(1);
      expect(primary?.lastActivityIso).not.toBeNull();
      // No spend in the prior window → 100 (matches summary's pctChange semantic).
      expect(primary?.deltaPctVsPriorWindow).toBe(100);

      // Org-wide (null-teamId) source: carol's 14d-old $0.25 trace.
      expect(orgWide).toBeDefined();
      expect(orgWide?.teamName).toBe("Org-wide");
      expect(orgWide?.spendUsd).toBeCloseTo(0.25, 2);
      expect(orgWide?.requestCount).toBe(1);
      expect(orgWide?.sourceCount).toBe(1);

      // Sort: primary ($2.00) before orgWide ($0.25) since spend desc.
      const primaryIdx = rows.findIndex((r) => r.teamId === primaryTeamId);
      const orgWideIdx = rows.findIndex((r) => r.teamId === null);
      expect(primaryIdx).toBeLessThan(orgWideIdx);
    });

    it("excludes cross-org governance traces (TenantId isolation)", async () => {
      const service = ActivityMonitorService.create(prisma);
      const rows = await service.spendByTeam({
        organizationId: primaryOrg.id,
        windowDays: 30,
      });
      // Cross-org trace had spend=$50; if any leaked, primary's largest row
      // would be far above $2 + $0.25.
      const totalReturned = rows.reduce((sum, r) => sum + r.spendUsd, 0);
      expect(totalReturned).toBeLessThan(10);
      // Cross-org Team is a Team but its id should never surface here.
      const allTeamIds = rows.map((r) => r.teamId).filter(Boolean);
      expect(allTeamIds).toEqual([primaryTeamId]);
    });

    it("returns [] when org has no hidden Governance Project (no IngestionSource ever minted)", async () => {
      const orgNoGov = await prisma.organization.create({
        data: {
          name: `No-gov Org ${nanoid(6)}`,
          slug: `no-gov-${nanoid(6)}`,
        },
      });
      const service = ActivityMonitorService.create(prisma);
      const rows = await service.spendByTeam({
        organizationId: orgNoGov.id,
        windowDays: 30,
      });
      expect(rows).toEqual([]);
      await prisma.organization.delete({ where: { id: orgNoGov.id } });
    });
  });

  describe("when querying spendByUser() with pagination + sort args (v2 spec line 157)", () => {
    it("limit + offset paginate the same ordering — sortBy='spend' desc returns bob ($1.50) on page 0, alice ($0.50) on page 1", async () => {
      const service = ActivityMonitorService.create(prisma);
      const page0 = await service.spendByUser({
        organizationId: primaryOrg.id,
        windowDays: 30,
        limit: 1,
        offset: 0,
        sortBy: "spend",
        sortDir: "desc",
      });
      const page1 = await service.spendByUser({
        organizationId: primaryOrg.id,
        windowDays: 30,
        limit: 1,
        offset: 1,
        sortBy: "spend",
        sortDir: "desc",
      });
      expect(page0).toHaveLength(1);
      expect(page0[0]!.actor).toBe("bob@example.com");
      expect(page1).toHaveLength(1);
      expect(page1[0]!.actor).toBe("alice@example.com");
    });

    it("sortDir='asc' inverts the ordering — carol ($0.25) is the smallest spender so she comes first", async () => {
      const service = ActivityMonitorService.create(prisma);
      const rows = await service.spendByUser({
        organizationId: primaryOrg.id,
        windowDays: 30,
        limit: 50,
        sortBy: "spend",
        sortDir: "asc",
      });
      const actors = rows.map((r) => r.actor);
      expect(actors[0]).toBe("carol@example.com");
      expect(actors[actors.length - 1]).toBe("bob@example.com");
    });

    it("sortBy='lastActivity' desc puts the recently-active users before carol's 14d-old row", async () => {
      const service = ActivityMonitorService.create(prisma);
      const rows = await service.spendByUser({
        organizationId: primaryOrg.id,
        windowDays: 30,
        limit: 50,
        sortBy: "lastActivity",
        sortDir: "desc",
      });
      const carolIdx = rows.findIndex((r) => r.actor === "carol@example.com");
      const aliceIdx = rows.findIndex((r) => r.actor === "alice@example.com");
      const bobIdx = rows.findIndex((r) => r.actor === "bob@example.com");
      // carol is 14d ago; alice + bob are 12h ago — carol must be last.
      expect(carolIdx).toBeGreaterThan(aliceIdx);
      expect(carolIdx).toBeGreaterThan(bobIdx);
    });

    it("legacy callers (no pagination/sort args) still get the v1 default — top-N by spend desc", async () => {
      const service = ActivityMonitorService.create(prisma);
      const rows = await service.spendByUser({
        organizationId: primaryOrg.id,
        windowDays: 30,
      });
      // Default ordering = spend desc — bob ($1.50) ahead of alice ($0.50)
      // ahead of carol ($0.25). Same shape as the v1 contract.
      const bobIdx = rows.findIndex((r) => r.actor === "bob@example.com");
      const aliceIdx = rows.findIndex((r) => r.actor === "alice@example.com");
      const carolIdx = rows.findIndex((r) => r.actor === "carol@example.com");
      expect(bobIdx).toBeLessThan(aliceIdx);
      expect(aliceIdx).toBeLessThan(carolIdx);
    });
  });

  describe("when querying spendByTeam() with pagination + sort args (v2 spec line 157)", () => {
    it("limit caps the page; offset paginates — limit=1 offset=0 gets primary team, offset=1 gets Org-wide", async () => {
      const service = ActivityMonitorService.create(prisma);
      const page0 = await service.spendByTeam({
        organizationId: primaryOrg.id,
        windowDays: 30,
        limit: 1,
        offset: 0,
        sortBy: "spend",
        sortDir: "desc",
      });
      const page1 = await service.spendByTeam({
        organizationId: primaryOrg.id,
        windowDays: 30,
        limit: 1,
        offset: 1,
        sortBy: "spend",
        sortDir: "desc",
      });
      expect(page0).toHaveLength(1);
      expect(page0[0]!.teamId).toBe(primaryTeamId);
      expect(page1).toHaveLength(1);
      expect(page1[0]!.teamId).toBeNull(); // Org-wide bucket
    });

    it("sortDir='asc' inverts the ordering — Org-wide ($0.25) before primary team ($2.00)", async () => {
      const service = ActivityMonitorService.create(prisma);
      const rows = await service.spendByTeam({
        organizationId: primaryOrg.id,
        windowDays: 30,
        limit: 10,
        sortBy: "spend",
        sortDir: "asc",
      });
      expect(rows[0]!.teamId).toBeNull();
      expect(rows[rows.length - 1]!.teamId).toBe(primaryTeamId);
    });

    it("sortBy='lastActivity' desc puts the team with the recent activity first", async () => {
      const service = ActivityMonitorService.create(prisma);
      const rows = await service.spendByTeam({
        organizationId: primaryOrg.id,
        windowDays: 30,
        limit: 10,
        sortBy: "lastActivity",
        sortDir: "desc",
      });
      // Primary team's last activity is 12h ago; Org-wide's is 14d ago.
      const primaryIdx = rows.findIndex((r) => r.teamId === primaryTeamId);
      const orgWideIdx = rows.findIndex((r) => r.teamId === null);
      expect(primaryIdx).toBeLessThan(orgWideIdx);
    });

    it("sortBy='requests' desc orders by raw request count, not spend", async () => {
      const service = ActivityMonitorService.create(prisma);
      const rows = await service.spendByTeam({
        organizationId: primaryOrg.id,
        windowDays: 30,
        limit: 10,
        sortBy: "requests",
        sortDir: "desc",
      });
      // Primary team has 2 requests (alice + bob), Org-wide has 1 (carol).
      expect(rows[0]!.teamId).toBe(primaryTeamId);
      expect(rows[0]!.requestCount).toBe(2);
    });

    it("legacy callers (no pagination/sort args) still get the v1 default — top-N by spend desc", async () => {
      const service = ActivityMonitorService.create(prisma);
      const rows = await service.spendByTeam({
        organizationId: primaryOrg.id,
        windowDays: 30,
      });
      // Default ordering = spend desc — primary ($2.00) before Org-wide ($0.25).
      const primaryIdx = rows.findIndex((r) => r.teamId === primaryTeamId);
      const orgWideIdx = rows.findIndex((r) => r.teamId === null);
      expect(primaryIdx).toBeLessThan(orgWideIdx);
    });
  });

  describe("when querying ingestionSourcesHealth()", () => {
    it("returns per-source eventsLast24h summed across trace_summaries + stored_log_records", async () => {
      const service = ActivityMonitorService.create(prisma);
      const rows = await service.ingestionSourcesHealth({
        organizationId: primaryOrg.id,
      });
      const primary = rows.find((r) => r.id === primarySourceId);
      const secondary = rows.find((r) => r.id === secondarySourceId);
      // Primary OTel source has 2 traces in last 24h
      expect(primary?.eventsLast24h).toBe(2);
      // Secondary cowork source has 1 log_record in last 24h (trace was 14d ago)
      expect(secondary?.eventsLast24h).toBe(1);
    });
  });

  describe("when querying sourceHealthMetrics() for a single source", () => {
    it("returns 24h/7d/30d event counts + lastSuccessIso", async () => {
      const service = ActivityMonitorService.create(prisma);
      const metrics = await service.sourceHealthMetrics({
        organizationId: primaryOrg.id,
        sourceId: primarySourceId,
      });
      // 2 traces in 24h; 0 log records for primary source
      expect(metrics.events24h).toBe(2);
      expect(metrics.events7d).toBe(2);
      expect(metrics.events30d).toBe(2);
      expect(metrics.lastSuccessIso).not.toBeNull();
    });
  });

  describe("when querying eventsForSource() for the trace drill-down list", () => {
    it("returns governance-origin traces matching the sourceId filter", async () => {
      const service = ActivityMonitorService.create(prisma);
      const rows = await service.eventsForSource({
        organizationId: primaryOrg.id,
        sourceId: primarySourceId,
        limit: 50,
      });
      expect(rows.length).toBe(2);
      const actors = rows.map((r) => r.actor);
      expect(actors).toContain("alice@example.com");
      expect(actors).toContain("bob@example.com");
      // Cross-source rows excluded
      expect(rows.every((r) => r.eventType === "otel_generic")).toBe(true);
    });
  });

  describe("when querying spendOverTime() for the bird's-eye stacked-area chart", () => {
    it("returns dense daily buckets covering windowDays — empty days emit `points: []` so the X axis has no gaps", async () => {
      const service = ActivityMonitorService.create(prisma);
      const result = await service.spendOverTime({
        organizationId: primaryOrg.id,
        windowDays: 30,
        groupBy: "team",
      });

      expect(result.buckets).toHaveLength(30);
      // Every bucket has an ISO timestamp at UTC midnight (no time-of-day drift).
      for (const bucket of result.buckets) {
        expect(new Date(bucket.bucketIso).getUTCHours()).toBe(0);
        expect(new Date(bucket.bucketIso).getUTCMinutes()).toBe(0);
      }
      // Buckets are strictly ascending by day.
      for (let i = 1; i < result.buckets.length; i++) {
        expect(
          new Date(result.buckets[i]!.bucketIso).getTime(),
        ).toBeGreaterThan(new Date(result.buckets[i - 1]!.bucketIso).getTime());
      }
      // Anti-regression for the bucket-key arithmetic that produced
      // empty `points: []` despite live data (CH date-math bug caught
      // by Alexis on 82d485fe3 dogfood). At least one bucket must
      // populate against the seeded fixture — a structurally-correct
      // dense response with no points anywhere is exactly the symptom
      // we're guarding against.
      const populated = result.buckets.filter((b) => b.points.length > 0);
      expect(populated.length).toBeGreaterThan(0);
    });

    it("groups by team — primary team appears in the recent bucket; Org-wide in the 14d-ago bucket", async () => {
      const service = ActivityMonitorService.create(prisma);
      const result = await service.spendOverTime({
        organizationId: primaryOrg.id,
        windowDays: 30,
        groupBy: "team",
      });

      const totalSpend = result.buckets
        .flatMap((b) => b.points)
        .reduce((sum, p) => sum + p.spendUsd, 0);
      // tr-primary-1 ($0.50) + tr-primary-2 ($1.50) + tr-primary-3 ($0.25)
      // governance-origin only — app trace ($99) excluded.
      expect(totalSpend).toBeCloseTo(2.25, 2);

      const primaryTeamPoints = result.buckets
        .flatMap((b) => b.points)
        .filter((p) => p.key === primaryTeamId);
      const primarySpend = primaryTeamPoints.reduce(
        (sum, p) => sum + p.spendUsd,
        0,
      );
      expect(primarySpend).toBeCloseTo(2.0, 2);

      const orgWidePoints = result.buckets
        .flatMap((b) => b.points)
        .filter((p) => p.key === "__org_wide__");
      const orgWideSpend = orgWidePoints.reduce(
        (sum, p) => sum + p.spendUsd,
        0,
      );
      expect(orgWideSpend).toBeCloseTo(0.25, 2);
      expect(orgWidePoints[0]?.label).toBe("Org-wide");
    });

    it("groups by user — alice + bob in recent bucket, carol in 14d-ago bucket", async () => {
      const service = ActivityMonitorService.create(prisma);
      const result = await service.spendOverTime({
        organizationId: primaryOrg.id,
        windowDays: 30,
        groupBy: "user",
      });

      const flatPoints = result.buckets.flatMap((b) =>
        b.points.map((p) => ({ ...p, bucketIso: b.bucketIso })),
      );

      const alice = flatPoints.find((p) => p.key === "alice@example.com");
      const bob = flatPoints.find((p) => p.key === "bob@example.com");
      const carol = flatPoints.find((p) => p.key === "carol@example.com");

      expect(alice?.spendUsd).toBeCloseTo(0.5, 2);
      expect(bob?.spendUsd).toBeCloseTo(1.5, 2);
      expect(carol?.spendUsd).toBeCloseTo(0.25, 2);

      // 'should-not-count@example.com' came from a non-governance-origin trace
      // — it MUST NOT appear in any bucket.
      expect(
        flatPoints.find((p) => p.key === "should-not-count@example.com"),
      ).toBeUndefined();
    });

    it("groups by model — claude-sonnet-4 only; app-model is excluded by origin filter", async () => {
      const service = ActivityMonitorService.create(prisma);
      const result = await service.spendOverTime({
        organizationId: primaryOrg.id,
        windowDays: 30,
        groupBy: "model",
      });

      const distinctModels = new Set(
        result.buckets.flatMap((b) => b.points.map((p) => p.key)),
      );
      expect(distinctModels.has("claude-sonnet-4")).toBe(true);
      // app-model is on a non-governance-origin trace → excluded.
      expect(distinctModels.has("app-model")).toBe(false);
    });

    it("honors TenantId isolation — cross-org $50 spend never appears in primary org's series", async () => {
      const service = ActivityMonitorService.create(prisma);
      const result = await service.spendOverTime({
        organizationId: primaryOrg.id,
        windowDays: 30,
        groupBy: "user",
      });

      const flatPoints = result.buckets.flatMap((b) => b.points);
      // The cross-org actor MUST NOT leak.
      expect(
        flatPoints.find((p) => p.key === "alice@cross.example.com"),
      ).toBeUndefined();
      // Total spend bounded by primary's seeded amount (2.25) — proves no
      // cross-org $50 leaked even into a different attribution dimension.
      const totalSpend = flatPoints.reduce((sum, p) => sum + p.spendUsd, 0);
      expect(totalSpend).toBeCloseTo(2.25, 2);
    });

    it("orders points within a bucket by spend desc — largest contributor first for stable Recharts stack rendering", async () => {
      const service = ActivityMonitorService.create(prisma);
      const result = await service.spendOverTime({
        organizationId: primaryOrg.id,
        windowDays: 30,
        groupBy: "user",
      });

      // The recent (12h-ago) bucket carries both alice (0.5) and bob (1.5).
      const populated = result.buckets.find((b) => b.points.length >= 2);
      expect(populated).toBeDefined();
      // Sorted desc: bob (1.5) before alice (0.5).
      expect(populated!.points[0]!.spendUsd).toBeGreaterThanOrEqual(
        populated!.points[1]!.spendUsd,
      );
    });

    it("returns dense empty-bucket structure for orgs with no governance project (no IngestionSource minted yet)", async () => {
      const orphan = await prisma.organization.create({
        data: {
          name: `Orphan Org Spend ${nanoid(6)}`,
          slug: `orphan-spend-${nanoid(6)}`,
        },
      });
      try {
        const service = ActivityMonitorService.create(prisma);
        const result = await service.spendOverTime({
          organizationId: orphan.id,
          windowDays: 7,
          groupBy: "team",
        });
        expect(result.buckets).toHaveLength(7);
        for (const bucket of result.buckets) {
          expect(bucket.points).toEqual([]);
        }
      } finally {
        await prisma.organization
          .delete({ where: { id: orphan.id } })
          .catch(() => undefined);
      }
    });
  });

  describe("Layer-1 invariant: hidden Governance Project", () => {
    it("created with PROJECT_KIND.INTERNAL_GOVERNANCE", () => {
      expect(primaryGovProject.kind).toBe(PROJECT_KIND.INTERNAL_GOVERNANCE);
    });
  });
});
