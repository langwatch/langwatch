/**
 * @vitest-environment node
 *
 * spendByDepartment - the bird's-eye widening (the #5 fix). Reads spend
 * across EVERY project in the org (not just the governance ingestion
 * silo) and rolls it up by the department resolved per trace. Seeds
 * ClickHouse directly so the read path is deterministic without the
 * trace pipeline.
 *
 * Binds the @birds-eye scenarios of departments.feature.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { type Organization } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { ActivityMonitorService } from "../activity-monitor/activityMonitor.service";

const USER_KEY = "langwatch.user_id";

async function insertTraceSummary(
  ch: ClickHouseClient,
  tenantId: string,
  trace: {
    traceId: string;
    occurredAt: Date;
    totalCost: number;
    attrs: Record<string, string>;
  },
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
        Models: ["claude-sonnet-4"],
        TotalCost: trace.totalCost,
        TokensEstimated: false,
        TotalPromptTokenCount: 10,
        TotalCompletionTokenCount: 5,
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

describe("ActivityMonitorService.spendByDepartment", () => {
  const ns = `deptspend-${nanoid(8)}`;
  let ch: ClickHouseClient;
  let org: Organization;
  let crossOrg: Organization;
  let engineeringId: string;
  let marketingId: string;
  let personalProjectId: string;
  let agentProjectId: string;
  let crossProjectId: string;

  const ROBIN = `usr-robin-${ns}`;
  const ROBIN_EMAIL = `robin-${ns}@example.com`;
  const STRANGER_EMAIL = `stranger-${ns}@example.com`;

  beforeAll(async () => {
    const maybeCh = getTestClickHouseClient();
    if (!maybeCh) throw new Error("ClickHouse test container not available");
    ch = maybeCh;

    org = await prisma.organization.create({
      data: { name: ns, slug: `org-${ns}` },
    });
    crossOrg = await prisma.organization.create({
      data: { name: `${ns}-x`, slug: `org-x-${ns}` },
    });

    const engineering = await prisma.department.create({
      data: { organizationId: org.id, name: "Engineering" },
    });
    const marketing = await prisma.department.create({
      data: { organizationId: org.id, name: "Marketing" },
    });
    engineeringId = engineering.id;
    marketingId = marketing.id;
    // Same-named department in the other org - proves the rollup keys on
    // this org's ids, never a name collision across orgs.
    const crossEngineering = await prisma.department.create({
      data: { organizationId: crossOrg.id, name: "Engineering" },
    });

    const team = await prisma.team.create({
      data: {
        name: `platform-${ns}`,
        slug: `platform-${ns}`,
        organizationId: org.id,
      },
    });
    const crossTeam = await prisma.team.create({
      data: {
        name: `x-team-${ns}`,
        slug: `x-team-${ns}`,
        organizationId: crossOrg.id,
      },
    });

    // The agent project carries Engineering directly (autonomous traffic,
    // no principal user → attributes by project).
    const agentProject = await prisma.project.create({
      data: {
        name: `agent-${ns}`,
        slug: `agent-${ns}`,
        teamId: team.id,
        language: "en",
        framework: "openai",
        apiKey: `key-agent-${ns}`,
        departmentId: engineeringId,
      },
    });
    // The personal project has no department - robin's personal traces
    // attribute by robin's own department, not the project's.
    const personalProject = await prisma.project.create({
      data: {
        name: `personal-${ns}`,
        slug: `personal-${ns}`,
        teamId: team.id,
        language: "en",
        framework: "openai",
        apiKey: `key-personal-${ns}`,
      },
    });
    const crossProject = await prisma.project.create({
      data: {
        name: `x-proj-${ns}`,
        slug: `x-proj-${ns}`,
        teamId: crossTeam.id,
        language: "en",
        framework: "openai",
        apiKey: `key-x-${ns}`,
        departmentId: crossEngineering.id,
      },
    });
    agentProjectId = agentProject.id;
    personalProjectId = personalProject.id;
    crossProjectId = crossProject.id;

    await prisma.user.create({
      data: { id: ROBIN, email: ROBIN_EMAIL, name: "Robin" },
    });
    await prisma.organizationUser.create({
      data: {
        organizationId: org.id,
        userId: ROBIN,
        role: "MEMBER",
        departmentId: marketingId,
      },
    });

    const inWindow = new Date(Date.now() - 12 * 60 * 60 * 1000);

    // Robin's personal AI use → Marketing (his own department).
    await insertTraceSummary(ch, personalProjectId, {
      traceId: `tr-robin-${nanoid()}`,
      occurredAt: inWindow,
      totalCost: 2.0,
      attrs: { [USER_KEY]: ROBIN_EMAIL },
    });
    // Autonomous agent traffic, no principal user → Engineering (project).
    await insertTraceSummary(ch, agentProjectId, {
      traceId: `tr-agent-${nanoid()}`,
      occurredAt: inWindow,
      totalCost: 3.0,
      attrs: {},
    });
    // A principal user with no department anywhere, in a project with no
    // department → Unassigned.
    await insertTraceSummary(ch, personalProjectId, {
      traceId: `tr-stranger-${nanoid()}`,
      occurredAt: inWindow,
      totalCost: 1.0,
      attrs: { [USER_KEY]: STRANGER_EMAIL },
    });
    // Cross-org spend under a like-named "Engineering" department.
    await insertTraceSummary(ch, crossProjectId, {
      traceId: `tr-cross-${nanoid()}`,
      occurredAt: inWindow,
      totalCost: 50.0,
      attrs: {},
    });
  });

  afterAll(async () => {
    await prisma.project
      .deleteMany({ where: { team: { organizationId: { in: [org.id, crossOrg.id] } } } })
      .catch(() => undefined);
    await prisma.team
      .deleteMany({ where: { organizationId: { in: [org.id, crossOrg.id] } } })
      .catch(() => undefined);
    await prisma.organizationUser
      .deleteMany({ where: { organizationId: org.id } })
      .catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: ROBIN } }).catch(() => undefined);
    await prisma.department
      .deleteMany({ where: { organizationId: { in: [org.id, crossOrg.id] } } })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: { in: [org.id, crossOrg.id] } } })
      .catch(() => undefined);
    await cleanupTestData(personalProjectId);
    await cleanupTestData(agentProjectId);
    await cleanupTestData(crossProjectId);
  });

  describe("given spend across personal, team, and agent projects", () => {
    /** @scenario Spend by department aggregates across every project in the org */
    it("rolls personal, agent, and unattributed spend up by department across all projects", async () => {
      const service = ActivityMonitorService.create(prisma);
      const rows = await service.spendByDepartment({
        organizationId: org.id,
        windowDays: 7,
      });

      const byName = new Map(rows.map((r) => [r.departmentName, r]));
      expect(byName.get("Engineering")?.spendUsd).toBeCloseTo(3.0, 2);
      expect(byName.get("Marketing")?.spendUsd).toBeCloseTo(2.0, 2);
      expect(byName.get("Unassigned")?.spendUsd).toBeCloseTo(1.0, 2);

      // The whole org's spend rolls up (2 + 3 + 1 = 6), proving the card is
      // not limited to a single governance ingestion project.
      const total = rows.reduce((sum, r) => sum + r.spendUsd, 0);
      expect(total).toBeCloseTo(6.0, 2);
    });
  });

  describe("given another org with spend under a like-named department", () => {
    /** @scenario Spend-by-department query stays tenant-isolated */
    it("never includes the other org's spend in this org's rollup", async () => {
      const service = ActivityMonitorService.create(prisma);
      const rows = await service.spendByDepartment({
        organizationId: org.id,
        windowDays: 7,
      });
      const total = rows.reduce((sum, r) => sum + r.spendUsd, 0);
      // The cross-org $50 must not leak - primary's total stays at $6.
      expect(total).toBeLessThan(10);
      // The Engineering row is this org's $3 agent spend, not the cross
      // org's $50 under its own like-named Engineering department.
      const engineering = rows.find((r) => r.departmentId === engineeringId);
      expect(engineering?.spendUsd).toBeCloseTo(3.0, 2);
    });
  });

  describe("given members with personal spend in different departments", () => {
    /** @scenario Marketing-versus-engineering comparison reads from departments */
    it("shows each department's combined personal and project spend", async () => {
      const service = ActivityMonitorService.create(prisma);
      const rows = await service.spendByDepartment({
        organizationId: org.id,
        windowDays: 7,
      });
      const marketing = rows.find((r) => r.departmentId === marketingId);
      const engineering = rows.find((r) => r.departmentId === engineeringId);
      // Marketing carries robin's personal AI use; Engineering carries the
      // team's agent project. The comparison reads departments, not RBAC.
      expect(marketing?.spendUsd).toBeCloseTo(2.0, 2);
      expect(engineering?.spendUsd).toBeCloseTo(3.0, 2);
    });
  });
});
