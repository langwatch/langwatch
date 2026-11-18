// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 * Each OCSF page elects the latest version of its own keys only: the election is ordered and
 * capped to the page and carries each key's EventTime, under the one tenant the read names.
 * What the server then reads is measured in clickhouse.ocsf-events.page-cost.integration.test.ts.
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { ClickHouseIngestionSourceEventsRepository } from "../clickhouse.ingestion-source-events.repository.ts";
import { ClickHouseOcsfEventsRepository } from "../clickhouse.ocsf-events.repository.ts";

const TENANT = "governance-project";
const ELECTION =
  "tuple(TenantId, EventId, LastUpdatedAt, EventTime) IN (SELECT TenantId, EventId, max(LastUpdatedAt) AS Latest, argMax(EventTime, LastUpdatedAt) AS LatestTime FROM governance_ocsf_events WHERE TenantId = {tenantId:String} AND";

async function statementOf(
  read: (resolve: () => Promise<never>) => Promise<unknown>,
): Promise<ReaderReadStatement> {
  const statements: ReaderReadStatement[] = [];
  const client = {
    read: async ({ statement }: { statement: ReaderReadStatement }) => {
      statements.push(statement);
      return { rows: [] };
    },
  };
  await read(async () => client as never);
  expect(statements).toHaveLength(1);
  const [statement] = statements;
  expect(statement).toMatchObject({ identity: "reader", kind: "tenant", tenantId: TENANT });
  expect(statement?.sql).not.toContain(TENANT);
  return statement!;
}

describe("an OCSF page's election", () => {
  describe("when the SIEM export reads a page after its cursor", () => {
    it("elects the page's keys only, in EventTime order, past the cursor on both sides", async () => {
      const { sql } = await statementOf((resolve) =>
        ClickHouseOcsfEventsRepository.create(resolve).findAll({
          tenantId: TENANT,
          sinceMs: 5,
          sinceEventId: "e-0",
          limit: 7,
        }),
      );

      expect(sql).toContain(ELECTION);
      expect(sql).toContain(
        "GROUP BY TenantId, EventId ORDER BY LatestTime ASC, EventId ASC LIMIT 7)) ORDER BY EventTime ASC, EventId ASC LIMIT 7",
      );
      expect(sql.match(/EventTime >= fromUnixTimestamp64Milli/g)).toHaveLength(2);
    });
  });

  describe("when the SIEM stream reads a page after its stored-at watermark", () => {
    it("elects past the watermark in write order and returns each event once", async () => {
      const { sql } = await statementOf((resolve) =>
        ClickHouseOcsfEventsRepository.create(resolve).findAllByIngest({
          tenantId: TENANT,
          afterIngestedMs: 9,
          afterEventId: "e-1",
          limit: 3,
          sourceType: "ocsf_push",
        }),
      );

      expect(sql).toContain(ELECTION);
      expect(sql).toMatch(
        /HAVING tuple\(max\(LastUpdatedAt\), EventId\) > tuple\(fromUnixTimestamp64Milli\(\{v\d+:Int64\}\), \{v\d+:String\}\) ORDER BY Latest ASC, EventId ASC LIMIT 3\)\)/,
      );
      expect(sql).toMatch(/ORDER BY LastUpdatedAt ASC, EventId ASC LIMIT 1 BY EventId LIMIT 3$/);
      expect(sql.match(/SourceType = \{v\d+:String\}/g)).toHaveLength(2);
    });
  });

  describe("when the activity drawer reads a source's newest pulled events", () => {
    it("elects the page's keys only, newest first", async () => {
      const { sql } = await statementOf((resolve) =>
        ClickHouseIngestionSourceEventsRepository.create(resolve).findPulledEventsForSource({
          organizationId: "org-a",
          tenantId: TENANT,
          sourceId: "s-1",
          beforeMs: 2,
          limit: 5,
        }),
      );

      expect(sql).toContain(ELECTION);
      expect(sql).toContain(
        "GROUP BY TenantId, EventId ORDER BY LatestTime DESC, EventId DESC LIMIT 5)) ORDER BY EventTime DESC, EventId DESC LIMIT 5",
      );
    });
  });
});
