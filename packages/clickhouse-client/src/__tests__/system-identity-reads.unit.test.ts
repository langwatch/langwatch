/**
 * A built read of a system table naming other tenants leaves on the system identity only: routed
 * by tenant or organisation in the worker, refused by name in a process holding no system
 * credential (the api), and never sent as server metadata on the reader.
 * @see specs/clickhouse/app-reader-identity.feature
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { describe, expect, it } from "vitest";

import { fn } from "../builder/functions.ts";
import { clickhouseRead, type MetadataReadStatement } from "../builder/read.ts";
import { tenantScope } from "../builder/scope.ts";
import { systemColumns } from "../builder/system-tables.ts";
import { ClickHouseQueryClient } from "../client.ts";
import { TENANT_IDS_SETTING } from "../identity/tenantSetting.ts";
import { idIndexTenantsStatement } from "../idIndexRetention.ts";
import type { QueryDriver, QueryRequest } from "../query.ts";
import { TenantGuard } from "../tenantGuard.ts";
import { mutationProgressRead } from "./fixtures/system-identity-reads.ts";

function recordingDriver(): QueryDriver & { sent: QueryRequest[] } {
  const sent: QueryRequest[] = [];
  const record = async (request: QueryRequest) => {
    sent.push(request);
  };
  return {
    sent,
    execute: async <Row>(request: QueryRequest) => {
      sent.push(request);
      return { rows: [] as Row[] };
    },
    command: record,
    insert: record,
  };
}

/** The worker holds the system credential; the api holds only the reader and the writer. */
function clientFor({ role }: { role: "worker" | "api" }) {
  const reader = recordingDriver();
  const system = recordingDriver();
  const writer = recordingDriver();
  const client = new ClickHouseQueryClient({
    ...(role === "worker" ? { driver: system } : { writerDriver: writer }),
    readerDriver: reader,
    tenantGuard: new TenantGuard(),
  });
  return { client, reader, system, writer };
}

async function codeOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
  throw new Error("expected a refusal");
}

const progress = () => mutationProgressRead({ needle: "TenantId = 'project_a'" });

describe("given a built all-tenants read of system.mutations", () => {
  describe("when the worker reads it with a tenant route", () => {
    /** @scenario "A built system-table read is sent as the system, routed by tenant or organisation" */
    it("sends it on the system identity to that tenant's server, with no tenant setting", async () => {
      const { client, reader, system } = clientFor({ role: "worker" });
      const statement = progress();

      await client.read({ statement, table: "system.mutations", tenantId: "project_a" });

      expect(reader.sent).toEqual([]);
      expect(system.sent).toHaveLength(1);
      expect(system.sent[0]).toMatchObject({
        sql: statement.sql,
        tenantId: "project_a",
        table: "system.mutations",
        // The all-tenants read of a system table spans every tenant on its server.
        SKIP_TENANT_CHECK: true,
      });
      expect(system.sent[0]?.organizationId).toBeUndefined();
      expect(system.sent[0]?.settings).not.toHaveProperty(TENANT_IDS_SETTING);
    });
  });

  describe("when the worker reads it for an organisation's server", () => {
    /** @scenario "A built system-table read is sent as the system, routed by tenant or organisation" */
    it("sends it on the system identity with that organisation", async () => {
      const { client, reader, system } = clientFor({ role: "worker" });

      await client.read({ statement: progress(), organizationId: "org_routed" });

      expect(reader.sent).toEqual([]);
      expect(system.sent[0]).toMatchObject({ tenantId: "", organizationId: "org_routed" });
    });
  });

  describe("when the api's client, holding no system credential, reads it", () => {
    /** @scenario "A built system-table read is sent as the system, routed by tenant or organisation" */
    it("refuses it by name and sends nothing on the reader or the writer", async () => {
      const { client, reader, writer } = clientFor({ role: "api" });

      const code = await codeOf(() =>
        client.read({ statement: progress(), table: "system.mutations", tenantId: "project_a" }),
      );

      expect(code).toBe("clickhouse_system_identity_absent");
      expect(reader.sent).toEqual([]);
      expect(writer.sent).toEqual([]);
    });
  });
});

describe("given a metadata statement whose text names system.mutations", () => {
  describe("when the client reads it", () => {
    /** @scenario "A server-metadata statement naming system.mutations is refused before it is sent" */
    it("refuses it before either identity receives it", async () => {
      const { client, reader, system } = clientFor({ role: "worker" });
      const forged: MetadataReadStatement = {
        identity: "reader",
        kind: "metadata",
        sql: "SELECT command FROM system.mutations",
        params: {},
        settings: { prefer_column_name_to_alias: 1, enable_global_with_statement: 1 },
        reason: "forged",
      };

      const code = await codeOf(() => client.read({ statement: forged }));

      expect(code).toBe("clickhouse_metadata_table_refused");
      expect(reader.sent).toEqual([]);
      expect(system.sent).toEqual([]);
    });
  });
});

describe("given a server-metadata read and an organisation id", () => {
  describe("when the client reads it", () => {
    /** @scenario "A server-metadata read routes by organisation" */
    it("sends it on the reader to that organisation's server, with no tenant setting", async () => {
      const { client, reader, system } = clientFor({ role: "worker" });
      const statement = clickhouseRead({
        scope: tenantScope.serverMetadata({ reason: "the routed server's columns" }),
      })
        .from(systemColumns)
        .select({ name: systemColumns.name })
        .where(({ eq }) => eq(systemColumns.database, fn.currentDatabase()))
        .build();

      await client.read({ statement, table: "system.columns", organizationId: "org_routed" });

      expect(system.sent).toEqual([]);
      expect(reader.sent[0]).toMatchObject({ tenantId: "", organizationId: "org_routed" });
      expect(reader.sent[0]?.settings).not.toHaveProperty(TENANT_IDS_SETTING);
      expect(reader.sent[0]?.SKIP_TENANT_CHECK).toBeUndefined();
    });
  });
});

describe("given a declared id index", () => {
  describe("when its tenant listing is built", () => {
    /** @scenario "An id index's tenant listing is an all-tenants read beside its raise" */
    it("selects the index's distinct tenants as a system statement", async () => {
      const statement = idIndexTenantsStatement({ index: "stored_spans_id_index" });
      const { client, system } = clientFor({ role: "worker" });

      await client.read({
        statement,
        table: "stored_spans_id_index",
        organizationId: "org_routed",
      });

      expect(statement).toMatchObject({
        identity: "system",
        kind: "allTenants",
        sql: "SELECT DISTINCT TenantId FROM stored_spans_id_index",
        params: {},
      });
      expect(system.sent[0]).toMatchObject({
        organizationId: "org_routed",
        // The all-tenants read of a system table spans every tenant on its server.
        SKIP_TENANT_CHECK: true,
      });
    });

    /** @scenario "An id index's tenant listing is an all-tenants read beside its raise" */
    it.each(["stored_spans", "stored_spans_id_index; DROP TABLE x", "", "`event_log_id_index`"])(
      "refuses %j, which is not an id index's table name",
      (index) => {
        expect(() => idIndexTenantsStatement({ index })).toThrow(
          expect.objectContaining({ violation: { kind: "not-an-id-index", table: index } }),
        );
      },
    );

    /** @scenario "An id index's tenant listing is an all-tenants read beside its raise" */
    it("is refused by the api's client, which holds no system credential", async () => {
      const { client, reader } = clientFor({ role: "api" });

      const code = await codeOf(() =>
        client.read({ statement: idIndexTenantsStatement({ index: "dspy_steps_id_index" }) }),
      );

      expect(code).toBe("clickhouse_system_identity_absent");
      expect(reader.sent).toEqual([]);
    });
  });
});
