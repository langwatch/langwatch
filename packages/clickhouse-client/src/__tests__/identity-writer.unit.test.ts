/**
 * The insert-only writer (ADR-202 Decided 12): which identity an insert leaves on, and that the
 * writer is never sent a read, a command or a skip-check statement.
 * @see specs/clickhouse/app-writer-identity.feature
 */
import { describe, expect, it } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import type { InsertRequest, QueryDriver, QueryRequest } from "../query.ts";
import { TenantGuard } from "../tenantGuard.ts";

/** A driver that records every statement it is sent and answers no rows. */
function recordingDriver(): QueryDriver & { sent: string[]; inserts: InsertRequest[] } {
  const sent: string[] = [];
  const inserts: InsertRequest[] = [];
  return {
    sent,
    inserts,
    execute: async <Row>(request: QueryRequest) => {
      sent.push(request.sql);
      return { rows: [] as Row[] };
    },
    command: async (request) => {
      sent.push(request.sql);
    },
    insert: async (request) => {
      inserts.push(request);
    },
  };
}

const TENANT_READ: QueryRequest = {
  tenantId: "project_a",
  sql: "SELECT StepId FROM dspy_steps WHERE TenantId = {tenantId:String}",
  params: { tenantId: "project_a" },
  table: "dspy_steps",
};

const SKIP_READ: QueryRequest = {
  tenantId: "project_a",
  sql: "SELECT name FROM system.columns",
  table: "system.columns",
  // The test's own cross-tenant read: the system schema, which no tenant owns.
  SKIP_TENANT_CHECK: true,
};

const COMMAND: QueryRequest = {
  tenantId: "project_a",
  sql: "ALTER TABLE dspy_steps DELETE WHERE TenantId = {tenantId:String}",
  params: { tenantId: "project_a" },
  table: "dspy_steps",
};

const INSERT: InsertRequest = {
  tenantId: "project_a",
  table: "dspy_steps",
  rows: [{ TenantId: "project_a", StepId: "s1" }],
};

function clientOver(drivers: {
  driver?: QueryDriver;
  readerDriver?: QueryDriver;
  writerDriver?: QueryDriver;
}) {
  return new ClickHouseQueryClient({ ...drivers, tenantGuard: new TenantGuard() });
}

describe("ClickHouseQueryClient writer identity", () => {
  describe("given a client holding the app reader and the writer, and no system identity", () => {
    /** @scenario "An insert in a process holding the reader and the writer is sent as the writer" */
    it("sends an insert on the writer and nothing on the reader", async () => {
      const reader = recordingDriver();
      const writer = recordingDriver();
      await clientOver({ readerDriver: reader, writerDriver: writer }).insert(INSERT);

      expect(writer.inserts).toEqual([INSERT]);
      expect(reader.inserts).toEqual([]);
      expect(reader.sent).toEqual([]);
    });

    /** @scenario "The writer never sends a read, a command or a statement that skips the tenant check" */
    it("refuses the skip-check read and the command by name and reads tenants on the reader", async () => {
      const reader = recordingDriver();
      const writer = recordingDriver();
      const client = clientOver({ readerDriver: reader, writerDriver: writer });

      await expect(client.query(SKIP_READ)).rejects.toMatchObject({
        code: "clickhouse_system_identity_absent",
      });
      await expect(client.command(COMMAND)).rejects.toMatchObject({
        code: "clickhouse_system_identity_absent",
      });
      await client.query(TENANT_READ);

      expect(reader.sent).toEqual([TENANT_READ.sql]);
      expect(writer.sent).toEqual([]);
      expect(writer.inserts).toEqual([]);
    });
  });

  describe("given a client holding the system identity, the app reader and the writer", () => {
    /** @scenario "A process holding the system identity keeps sending its inserts as the system" */
    it("sends an insert on the system identity and nothing on the writer", async () => {
      const system = recordingDriver();
      const writer = recordingDriver();
      await clientOver({
        driver: system,
        readerDriver: recordingDriver(),
        writerDriver: writer,
      }).insert(INSERT);

      expect(system.inserts).toEqual([INSERT]);
      expect(writer.inserts).toEqual([]);
      expect(writer.sent).toEqual([]);
    });
  });

  describe("given a client holding the app reader alone", () => {
    /** @scenario "An insert in a process holding neither the system nor the writer is refused by name" */
    it("refuses the insert by name, naming the operation and the table, and sends nothing", async () => {
      const reader = recordingDriver();
      await expect(clientOver({ readerDriver: reader }).insert(INSERT)).rejects.toMatchObject({
        code: "clickhouse_system_identity_absent",
        operation: "insert",
        table: "dspy_steps",
      });
      expect(reader.inserts).toEqual([]);
      expect(reader.sent).toEqual([]);
    });
  });
});
