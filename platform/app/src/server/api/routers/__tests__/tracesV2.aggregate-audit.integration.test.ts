/**
 * @vitest-environment node
 *
 * ADR-144 decision 9: any read of an aggregate writes the admin workspace
 * view row of kind `aggregate`, deduplicated per actor and aggregate for five
 * minutes. The row is written at the door where the read's proof is minted,
 * so it is driven here through the real tRPC trace routes with no page in
 * between, over the real grants ledger, a real ClickHouse and the real audit
 * service. The clock is moved by hand, never waited on.
 *
 * Spec: specs/governance/aggregate-project.feature, section G.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { ADMIN_WORKSPACE_VIEW_ACTION } from "@ee/governance/services/adminWorkspaceViewAudit.service";
import { workspaceViewAggregateReadAudit } from "@ee/governance/services/aggregateReadAudit";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  type Project,
  TeamUserRole,
} from "~/generated/prisma/client";
import { resetApp } from "~/server/app-layer/app";
import { resetAuthzGrantsCommandsForTests } from "~/server/app-layer/authz/ledger";
import {
  type AggregateFixture,
  seedAggregateOrganization,
} from "~/server/app-layer/projects/__tests__/aggregateProjectFixture";
import { AGGREGATE_PROJECT_KIND } from "~/server/app-layer/projects/project-kinds";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import {
  insertRows,
  installAggregateTraceApp,
  spanRow,
  summaryRow,
} from "./helpers/aggregateTraceRoutes";

const run = nanoid(8);
const TRACE_ID = `agg-audit-${run}`;
const MINUTE = 60 * 1000;

let ch: ClickHouseClient;
let fixture: AggregateFixture;
let aggregate: Project;
let member: Project;
let window: { from: number; to: number };
let occurredAt: number;
/** The audit's clock: real time plus whatever a case has moved it by. */
let skewMs = 0;

type Caller = ReturnType<typeof appRouter.createCaller>;
const callerFor = (userId: string): Caller =>
  appRouter.createCaller(
    createInnerTRPCContext({ session: { user: { id: userId }, expires: "1" } }),
  );

/** A fresh organisation admin, so each case starts with no audit row. */
async function freshAdmin(
  handle: string,
): Promise<{ id: string; caller: Caller }> {
  const user = await fixture.makeUser({
    handle,
    organizationRole: OrganizationUserRole.ADMIN,
    teamRole: TeamUserRole.ADMIN,
  });
  return { id: user.id, caller: callerFor(user.id) };
}

const listAggregate = (caller: Caller) =>
  caller.tracesV2.list({
    projectId: aggregate.id,
    timeRange: window,
    sort: { columnId: "timestamp", direction: "desc" },
    page: 1,
    pageSize: 100,
  });

const viewRowsOf = (userId: string) =>
  prisma.auditLog.findMany({
    where: { userId, action: ADMIN_WORKSPACE_VIEW_ACTION },
    orderBy: { createdAt: "asc" },
  });

beforeAll(async () => {
  ch = (await startTestContainers()).clickHouseClient;
  installAggregateTraceApp({
    ch,
    overrides: {
      aggregateReadAudit: workspaceViewAggregateReadAudit({
        prisma,
        now: () => new Date(Date.now() + skewMs),
      }),
    },
  });
  fixture = await seedAggregateOrganization(prisma, { label: "agg-audit" });
  member = fixture.shared;

  const { projectSlug } = await callerFor(fixture.admin.id).project.create({
    organizationId: fixture.organizationId,
    teamId: fixture.team.id,
    name: `Company view ${run}`,
    language: "other",
    framework: "other",
    kind: AGGREGATE_PROJECT_KIND,
    aggregateRule: { kind: "explicit", projectIds: [member.id] },
  });
  aggregate = await prisma.project.findFirstOrThrow({
    where: { slug: projectSlug, teamId: fixture.team.id },
  });

  occurredAt = Date.now() + 5_000;
  window = { from: occurredAt - 3_600_000, to: occurredAt + 3_600_000 };
  const holder = { tenantId: member.id, traceId: TRACE_ID, occurredAt };
  await insertRows({
    ch,
    table: "trace_summaries",
    values: [summaryRow(holder)],
  });
  await insertRows({ ch, table: "stored_spans", values: [spanRow(holder)] });
}, 180_000);

afterAll(async () => {
  try {
    await fixture?.cleanup();
  } finally {
    await resetApp();
    resetAuthzGrantsCommandsForTests();
    await stopTestContainers();
  }
});

describe("Feature: every read of an aggregate is audited", () => {
  describe("given an aggregate project with one member holding one trace", () => {
    describe("when ana opens the aggregate's trace list and then that trace within five minutes", () => {
      /** @scenario "Any read of the aggregate writes the admin view audit row" */
      it("writes one row of kind aggregate for ana and the aggregate, naming neither the trace nor the member", async () => {
        const ana = await freshAdmin("ana");

        const [row] = (await listAggregate(ana.caller)).items;
        if (!row) throw new Error("the member's trace is not listed");
        await ana.caller.tracesV2.header({
          projectId: aggregate.id,
          traceId: row.traceId,
          occurredAtMs: row.timestamp,
          tenantId: row.projectId,
          full: false,
        });
        await ana.caller.tracesV2.spanTree({
          projectId: aggregate.id,
          traceId: row.traceId,
          tenantId: row.projectId,
        });

        const rows = await viewRowsOf(ana.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          userId: ana.id,
          organizationId: fixture.organizationId,
          targetKind: "aggregate_project",
          targetId: aggregate.id,
        });
        const written = JSON.stringify(rows[0]);
        expect(written).not.toContain(TRACE_ID);
        expect(written).not.toContain(member.id);
      });
    });

    describe("when ana's first read is a deep link to one trace, with no list rendered", () => {
      it("writes the row from that read alone", async () => {
        const ana = await freshAdmin("deep-link");

        await ana.caller.tracesV2.spanTree({
          projectId: aggregate.id,
          traceId: TRACE_ID,
          tenantId: member.id,
        });

        expect((await viewRowsOf(ana.id)).map((row) => row.targetKind)).toEqual(
          ["aggregate_project"],
        );
      });
    });
  });

  describe("given an aggregate project", () => {
    describe("when ana opens its trace list twice within five minutes, then again ten minutes later", () => {
      /** @scenario "The audit row repeats after the five-minute window" */
      it("writes one row for the two reads and a second for the later one", async () => {
        const ana = await freshAdmin("window");

        await listAggregate(ana.caller);
        skewMs += 1 * MINUTE;
        await listAggregate(ana.caller);
        expect(await viewRowsOf(ana.id)).toHaveLength(1);

        skewMs += 10 * MINUTE;
        await listAggregate(ana.caller);

        const rows = await viewRowsOf(ana.id);
        expect(rows).toHaveLength(2);
        expect(rows.every((row) => row.targetId === aggregate.id)).toBe(true);
      });
    });
  });

  describe("given ana reads the aggregate and then a member directly", () => {
    describe("when the audit rows are counted", () => {
      it("writes the aggregate row only, and no personal or team row", async () => {
        const ana = await freshAdmin("kinds");

        await listAggregate(ana.caller);
        await ana.caller.tracesV2.list({
          projectId: member.id,
          timeRange: window,
          sort: { columnId: "timestamp", direction: "desc" },
          page: 1,
          pageSize: 100,
        });

        expect(
          (await viewRowsOf(ana.id)).map((row) => [
            row.targetKind,
            row.targetId,
          ]),
        ).toEqual([["aggregate_project", aggregate.id]]);
      });
    });
  });
});
