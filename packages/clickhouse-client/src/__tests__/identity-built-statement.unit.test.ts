/**
 * A statement the typed builder built, sent on the identity it names with its own settings.
 * @see specs/clickhouse/app-reader-identity.feature
 */
import { AuthorizationExpiredError } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { column } from "../builder/expression.ts";
import { clickhouseRead, type ReaderReadStatement } from "../builder/read.ts";
import { tenantScope } from "../builder/scope.ts";
import { defineClickHouseTable } from "../builder/table.ts";
import { ClickHouseQueryClient } from "../client.ts";
import { SystemIdentityAbsentError } from "../identity/statementIdentity.ts";
import { TENANT_IDS_SETTING, TenantSettingError } from "../identity/tenantSetting.ts";
import type { QueryDriver, QueryRequest } from "../query.ts";
import { TenantGuard } from "../tenantGuard.ts";

const traceSummaries = defineClickHouseTable({
  name: "trace_summaries",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  sortKey: ["TenantId", "TraceId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    OccurredAt: column.dateTime64({ precision: 3 }),
  },
});

function recordingDriver(): QueryDriver & { sent: QueryRequest[] } {
  const sent: QueryRequest[] = [];
  const refuse = () => Promise.reject(new Error("not a read"));
  return {
    sent,
    execute: async <Row>(request: QueryRequest) => {
      sent.push(request);
      return { rows: [] as Row[] };
    },
    command: refuse,
    insert: refuse,
  };
}

function clientWith({ system = true }: { system?: boolean } = {}) {
  const reader = recordingDriver();
  const systemDriver = recordingDriver();
  const client = new ClickHouseQueryClient({
    ...(system ? { driver: systemDriver } : {}),
    readerDriver: reader,
    tenantGuard: new TenantGuard(),
  });
  return { client, reader, system: systemDriver };
}

const setRead = (): ReaderReadStatement =>
  clickhouseRead({ scope: tenantScope.set({ tenantIds: ["project_a", "project_b"] }) })
    .from(traceSummaries)
    .select({ TraceId: traceSummaries.TraceId })
    .build();

const allTenantsRead = () =>
  clickhouseRead({ scope: tenantScope.allTenants({ reason: "retention sweep" }) })
    .from(traceSummaries)
    .select({ TraceId: traceSummaries.TraceId })
    .build();

async function refusalOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

describe("ClickHouseQueryClient.read() of a built statement", () => {
  describe("given a reader statement", () => {
    /** @scenario "A built reader statement is sent on the reader with its own settings" */
    it("sends it on the reader with its settings as built, routed by its route tenant", async () => {
      const { client, reader, system } = clientWith();
      const statement = setRead();

      await client.read({ statement, table: "trace_summaries" });

      expect(system.sent).toEqual([]);
      expect(reader.sent).toHaveLength(1);
      expect(reader.sent[0]).toMatchObject({
        tenantId: statement.routeTenantId,
        tenantIds: statement.tenantIds,
        sql: statement.sql,
        settings: statement.settings,
      });
      expect(reader.sent[0]?.settings?.[TENANT_IDS_SETTING]).toBe("project_a,project_b");
    });

    /** @scenario "A built statement whose tenant setting is not its tenant set is refused" */
    it.each([
      ["a wider tenant setting", "project_a,project_b,project_c"],
      ["no tenant setting", undefined],
    ])("refuses one carrying %s by name", async (_, carried) => {
      const { client, reader } = clientWith();
      const built = setRead();
      const { [TENANT_IDS_SETTING]: _own, ...pins } = built.settings;
      const statement = {
        ...built,
        settings: carried === undefined ? pins : { ...pins, [TENANT_IDS_SETTING]: carried },
      } as ReaderReadStatement;

      const error = await refusalOf(() => client.read({ statement }));

      expect(error).toBeInstanceOf(TenantSettingError);
      expect((error as TenantSettingError).violation).toMatchObject({ kind: "setting-mismatch" });
      expect(reader.sent).toEqual([]);
    });

    /** @scenario "A braided built read is cut to its proof's expiry" */
    it("caps its time limit at the proof's remaining seconds", async () => {
      const { client, reader } = clientWith();
      const statement = { ...setRead(), expiresAt: Date.now() + 30_000 };

      await client.read({ statement });

      const limit = Number(reader.sent[0]?.settings?.max_execution_time);
      expect(limit).toBeGreaterThanOrEqual(29);
      expect(limit).toBeLessThanOrEqual(30);
    });

    /** @scenario "A braided built read is cut to its proof's expiry" */
    it("refuses it once its proof has expired, before it is sent", async () => {
      const { client, reader } = clientWith();
      const statement = { ...setRead(), expiresAt: Date.now() - 1 };

      const error = await refusalOf(() => client.read({ statement }));

      expect(error).toBeInstanceOf(AuthorizationExpiredError);
      expect(reader.sent).toEqual([]);
    });
  });

  describe("given an all-tenants statement", () => {
    /** @scenario "A built all-tenants statement is sent as the system" */
    it("sends it on the system identity with its settings, without a tenant setting", async () => {
      const { client, reader, system } = clientWith();
      const statement = allTenantsRead();

      await client.read({ statement, table: "trace_summaries" });

      expect(reader.sent).toEqual([]);
      expect(system.sent).toHaveLength(1);
      expect(system.sent[0]?.settings).toEqual(statement.settings);
      expect(system.sent[0]?.settings?.[TENANT_IDS_SETTING]).toBeUndefined();
    });

    /** @scenario "A built all-tenants statement is sent as the system" */
    it("is refused by name in a reader-only process", async () => {
      const { client, reader } = clientWith({ system: false });

      const error = await refusalOf(() =>
        client.read({ statement: allTenantsRead(), table: "trace_summaries" }),
      );

      expect(error).toBeInstanceOf(SystemIdentityAbsentError);
      expect(reader.sent).toEqual([]);
    });
  });
});
