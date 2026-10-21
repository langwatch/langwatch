/**
 * An aggregate's statement read by a real ClickHouse as the restricted identity, over the shipped
 * migrations and views: the row policy bounds it to the members' keys, the rewrite to each
 * member's window, so a non-member and a dated member's earlier rows count nothing.
 * @see specs/lwql/aggregate-reads.feature
 * @vitest-environment node
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LangWatchQLViewProvisioningService } from "../../features/provisioning/services/langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "../../features/provisioning/services/langwatch-ql-view-statements.service.ts";
import { ClickHouseLangWatchQLExecutorRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-executor.repository.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { EVERY_CATALOGUE_PERMISSION } from "../../services/__tests__/lwql-catalogue-access.fixture.ts";
import { LangWatchQLService } from "../../services/langwatch-ql.service.ts";
import {
  type LangWatchQLClickHouseHarness,
  startLangWatchQLClickHouse,
} from "./lwql-clickhouse-harness.ts";

const viewProvisioning = LangWatchQLViewProvisioningService.create();

/** A day no harness seed writes to; project B is shared from its noon. */
const BEFORE = "2026-06-10 06:00:00.000";
const AFTER = "2026-06-10 18:00:00.000";
const SHARED_FROM = Date.parse("2026-06-10T12:00:00.000Z");
const WINDOW = { start: "2026-06-10T00:00:00.000Z", end: "2026-06-11T00:00:00.000Z" };
/** Holds rows but is no member: its key is never sent. */
const NON_MEMBER = "tenant-c";
const VIEWS = ["traces"];

const IN_PERIOD =
  "OccurredAt >= {dashboard_context_period_start:DateTime} " +
  "AND OccurredAt < {dashboard_context_period_end:DateTime}";
const COUNT_BY_TENANT =
  `SELECT TenantId, count() AS n FROM traces WHERE ${IN_PERIOD} ` +
  "GROUP BY TenantId ORDER BY TenantId";

describe("given an aggregate over project A for its whole history and project B from noon", () => {
  let harness: LangWatchQLClickHouseHarness;
  let service: LangWatchQLService;

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({ suite: "aggregatewindows", facts: "migrated" });
    const { names, factDatabase: facts, tenantA, tenantB } = harness;
    const views = LWQL_VIEW_CATALOG.filter((view) => VIEWS.includes(view.name));
    await harness.applyAsAdmin(
      viewProvisioning.setupStatements({
        names,
        sourceDatabase: facts,
        views,
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    );
    await harness.applyAccessModel({ views, sourceDatabase: facts });

    const rows = [
      { tenantId: tenantA.tenantId, at: BEFORE },
      { tenantId: tenantA.tenantId, at: AFTER },
      { tenantId: tenantB.tenantId, at: BEFORE },
      { tenantId: tenantB.tenantId, at: AFTER },
      { tenantId: NON_MEMBER, at: BEFORE },
      { tenantId: NON_MEMBER, at: AFTER },
    ];
    await harness.admin.insert({
      table: `${facts}.trace_summaries`,
      format: "JSONEachRow",
      values: rows.map(({ tenantId, at }, index) => ({
        ProjectionId: `${tenantId}/aggregate-windows-${index}`,
        TenantId: tenantId,
        TraceId: `${tenantId}-aggregate-windows-${index}`,
        Version: "1",
        OccurredAt: at,
        UpdatedAt: at,
      })),
    });

    service = LangWatchQLService.create({
      executor: ClickHouseLangWatchQLExecutorRepository.create({
        connection: {
          ...harness.restrictedConnection(),
          database: names.database,
          tenantSetting: names.tenantSetting,
        },
      }),
      database: names.database,
      views,
    });
  }, 600_000);

  afterAll(async () => {
    await service?.close();
    await harness?.stop();
  });

  describe("when ana counts trace rows on the aggregate through LangWatchQL", () => {
    /** @scenario "Nothing outside the members' windows is read" */
    it("counts project A's rows and project B's from noon, and none of project C's", async () => {
      const { tenantA, tenantB } = harness;

      const result = await service.executeForProjects({
        projects: [
          { id: tenantA.tenantId, lwqlKey: tenantA.rawSecret },
          { id: tenantB.tenantId, lwqlKey: tenantB.rawSecret },
        ],
        memberWindows: [
          { projectId: tenantA.tenantId, from: 0 },
          { projectId: tenantB.tenantId, from: SHARED_FROM },
        ],
        protections: {
          catalogue: EVERY_CATALOGUE_PERMISSION,
          canSeeCosts: true,
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
        },
        sql: COUNT_BY_TENANT,
        timeWindow: WINDOW,
      });

      expect(result.rows.map((row) => [row.TenantId, Number(row.n)])).toEqual([
        [tenantA.tenantId, 2],
        [tenantB.tenantId, 1],
      ]);
    });
  });
});
