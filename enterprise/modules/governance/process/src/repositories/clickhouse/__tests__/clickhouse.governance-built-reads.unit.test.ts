// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * ADR-202: the SIEM export and the spend-spike totals are built reads, each scoped to the one
 * tenant it names and sent on the reader identity with that tenant as its setting.
 *
 * Spec: specs/ai-gateway/governance/siem-export.feature, specs/ai-gateway/governance/folds.feature
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { AnomalySpendSourceFilter } from "../../governance.repositories.ts";
import { ClickHouseAnomalySpendRepository } from "../clickhouse.anomaly-spend.repository.ts";
import { ClickHouseOcsfEventsRepository } from "../clickhouse.ocsf-events.repository.ts";

const TENANT = "gov-project-1";

/** A client answering every built read with `rows`, recording each statement it is sent. */
function readingClient(rows: readonly Record<string, unknown>[]) {
  const statements: ReaderReadStatement[] = [];
  const client = {
    read: async ({ statement }: { statement: ReaderReadStatement }) => {
      statements.push(statement);
      return { rows };
    },
  };
  return { resolve: async () => client as never, statements };
}

function expectOneTenantRead(statements: readonly ReaderReadStatement[]): ReaderReadStatement {
  expect(statements).toHaveLength(1);
  const [statement] = statements;
  expect(statement).toMatchObject({ identity: "reader", kind: "tenant", tenantId: TENANT });
  expect(statement?.settings).toMatchObject({ SQL_langwatch_tenant_ids: TENANT });
  expect(statement?.sql).toContain("WHERE TenantId = {tenantId:String}");
  expect(statement?.sql).not.toContain(TENANT);
  return statement!;
}

describe("ClickHouseOcsfEventsRepository.findAll", () => {
  const input = { tenantId: TENANT, sinceMs: 1_000, sinceEventId: "evt-0", limit: 50 };

  it("reads one tenant's latest event versions after the cursor, on the reader", async () => {
    const { resolve, statements } = readingClient([]);

    await ClickHouseOcsfEventsRepository.create(resolve).findAll(input);

    const statement = expectOneTenantRead(statements);
    expect(statement.sql).toContain(
      "(TenantId, EventId, LastUpdatedAt) IN (SELECT TenantId, EventId, max(LastUpdatedAt) FROM governance_ocsf_events WHERE TenantId = {tenantId:String} AND tuple(EventTime, EventId) > tuple(",
    );
    expect(statement.sql).toContain("ORDER BY EventTime ASC, EventId ASC LIMIT 50");
    expect(Object.values(statement.params)).toEqual(
      expect.arrayContaining([TENANT, 1_000, "evt-0"]),
    );
  });

  it("maps each row to the export shape, numbers as numbers", async () => {
    const { resolve } = readingClient([
      {
        EventId: "evt-1",
        OcsfSchemaVersion: "1.1.0",
        TraceId: "trace-1",
        SourceId: "src-1",
        SourceType: "otel_generic",
        ClassUid: 6003,
        CategoryUid: 6,
        ActivityId: 6,
        TypeUid: 600306,
        SeverityId: 1,
        EventTimeMs: "1700000000000",
        ActorUserId: "user-1",
        ActorEmail: "a@example.com",
        ActorEnduserId: "",
        ActionName: "chat",
        TargetName: "gpt-5",
        AnomalyAlertId: "",
        RawOcsfJson: "{}",
      },
    ]);

    const [row] = await ClickHouseOcsfEventsRepository.create(resolve).findAll(input);

    expect(row).toMatchObject({
      eventId: "evt-1",
      typeUid: 600306,
      eventTimeMs: 1_700_000_000_000,
    });
  });
});

describe("ClickHouseAnomalySpendRepository.findSpendTotals", () => {
  const totals = (sourceFilter: AnomalySpendSourceFilter) => ({
    tenantId: TENANT,
    windowStart: Temporal.Instant.fromEpochMilliseconds(2_000),
    windowEnd: Temporal.Instant.fromEpochMilliseconds(3_000),
    baselineStart: Temporal.Instant.fromEpochMilliseconds(1_000),
    sourceFilter,
  });

  it("collapses each key to its latest spend inside one tenant before summing", async () => {
    const { resolve, statements } = readingClient([{ currentSpend: 9, baselineSpend: 2 }]);

    const result = await ClickHouseAnomalySpendRepository.create(resolve).findSpendTotals(
      totals({ type: "all" }),
    );

    expect(result).toEqual({ currentSpend: 9, baselineSpend: 2 });
    const statement = expectOneTenantRead(statements);
    expect(statement.sql).toContain("argMax(SpendUsd, LastEventOccurredAt)");
    expect(statement.sql).toContain("GROUP BY TenantId, SourceId, HourBucket, TraceId");
    expect(statement.sql).not.toMatch(/SourceId = |SourceType = /);
  });

  it.each([
    [{ type: "source", id: "src-1" } as const, /SourceId = \{\w+:String\}/],
    [{ type: "source_type", id: "otel_generic" } as const, /SourceType = \{\w+:String\}/],
  ])("narrows to the rule's %o inside the collapse", async (filter, rendered) => {
    const { resolve, statements } = readingClient([]);

    const result = await ClickHouseAnomalySpendRepository.create(resolve).findSpendTotals(
      totals(filter),
    );

    expect(result).toEqual({ currentSpend: 0, baselineSpend: 0 });
    const statement = expectOneTenantRead(statements);
    const inner = statement.sql.slice(statement.sql.indexOf("FROM (SELECT"));
    expect(inner.slice(0, inner.indexOf("GROUP BY"))).toMatch(rendered);
    expect(Object.values(statement.params)).toContain(filter.id);
  });
});
