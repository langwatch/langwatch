/**
 * The settlement sweep's read is install-wide by design: it runs on the system identity under an
 * all-tenants scope with its reason, elects each request's latest version inside the window, and
 * keeps only those still `admitted`.
 */
import type { SystemReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it, vi } from "vitest";

import { MAX_OPEN_ADMISSIONS_PER_SWEEP } from "../../../rules/gateway-spend-settlement.rules.ts";
import { ClickHouseGatewayOpenAdmissionsRepository } from "../clickhouse.gateway-open-admissions.repository.ts";
import type { GatewayClickHouseClient } from "../clickhouse.gateway-session.store.ts";

const NOW = Date.parse("2026-04-06T10:00:00.000Z");

describe("ClickHouseGatewayOpenAdmissionsRepository", () => {
  describe("when the sweep reads open admissions", () => {
    it("reads every tenant as the system identity, electing within the window", async () => {
      const statements: SystemReadStatement[] = [];
      const row = { tenantId: "t-1", gatewayRequestId: "req-1", admittedAtMs: NOW - 7_200_000 };
      const read = vi.fn().mockImplementation(async ({ statement }) => {
        statements.push(statement);
        return { rows: [row] };
      });
      const client: GatewayClickHouseClient = {
        read,
        query: async () => ({ json: async () => [] }),
        insert: async () => undefined,
      };

      const found = await ClickHouseGatewayOpenAdmissionsRepository.create(
        client,
      ).findOpenAdmissions({ now: NOW, graceMs: 3_600_000, lookbackMs: 10_800_000 });

      expect(found).toEqual([row]);
      const [statement] = statements;
      expect(statement).toMatchObject({ identity: "system", kind: "allTenants" });
      expect(statement?.settings).not.toHaveProperty("SQL_langwatch_tenant_ids");
      expect(statement?.sql).not.toContain("{tenantId:String}");
      expect(statement?.sql).toContain(
        "(TenantId, GatewayRequestId, EventTimestamp) IN (SELECT TenantId, GatewayRequestId, max(EventTimestamp)",
      );
      const election = statement?.sql.split(" IN (SELECT ")[1] ?? "";
      expect(election).toContain("OccurredAt < fromUnixTimestamp64Milli(");
      expect(election).not.toContain("Status");
      expect(statement?.sql).toContain(`LIMIT ${MAX_OPEN_ADMISSIONS_PER_SWEEP}`);
      expect(Object.values(statement?.params ?? {})).toEqual(
        expect.arrayContaining([NOW - 10_800_000, NOW - 3_600_000, "admitted"]),
      );
    });
  });
});
