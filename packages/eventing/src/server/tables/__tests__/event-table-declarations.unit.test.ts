/**
 * @see packages/eventing/specs/event-table-surfaces.feature
 */
import { Prisma } from "@langwatch/prisma-client/generated";
import { describe, expect, it } from "vitest";

import {
  EVENT_TABLE_DECLARATIONS,
  EVENT_TABLES,
  type EventTableExposedColumn,
  type EventTableOmittedColumn,
} from "../event-table-declarations.ts";

/** The source column an entry reads: its own key when omitted or when it names no source. */
function sourceOf([name, entry]: [
  string,
  EventTableExposedColumn | EventTableOmittedColumn,
]): string {
  return "omitted" in entry ? name : (entry.source ?? name);
}

const MODEL_FIELDS: Record<string, Record<string, string>> = {
  ProcessManagerInbox: Prisma.ProcessManagerInboxScalarFieldEnum,
  ProcessManagerInstance: Prisma.ProcessManagerInstanceScalarFieldEnum,
  ProcessManagerOutbox: Prisma.ProcessManagerOutboxScalarFieldEnum,
  ProcessManagerOutboxAttempt: Prisma.ProcessManagerOutboxAttemptScalarFieldEnum,
};

describe("EVENT_TABLE_DECLARATIONS", () => {
  describe("when the declarations are listed", () => {
    /** @scenario "Every event-table view analytics serves today is declared" */
    it("names today's views with their store, source table and tenant column", () => {
      expect(
        EVENT_TABLE_DECLARATIONS.map(({ view, store, sourceTable, tenantColumn }) => ({
          view,
          store,
          sourceTable,
          tenantColumn,
        })),
      ).toEqual([
        {
          view: "legacy_event_log",
          store: "clickhouse",
          sourceTable: "event_log",
          tenantColumn: "TenantId",
        },
        {
          view: "process_manager_inboxes",
          store: "postgres",
          sourceTable: "ProcessManagerInbox",
          tenantColumn: "TenantId",
        },
        {
          view: "process_manager_instances",
          store: "postgres",
          sourceTable: "ProcessManagerInstance",
          tenantColumn: "TenantId",
        },
        {
          view: "process_manager_outbox_attempts",
          store: "postgres",
          sourceTable: "ProcessManagerOutboxAttempt",
          tenantColumn: "TenantId",
        },
        {
          view: "process_manager_outboxes",
          store: "postgres",
          sourceTable: "ProcessManagerOutbox",
          tenantColumn: "TenantId",
        },
      ]);
      for (const declaration of EVENT_TABLE_DECLARATIONS) {
        expect(Object.keys(declaration.columns)).toContain(declaration.tenantColumn);
      }
    });
  });

  describe("when a process-manager table's declaration is read", () => {
    /** @scenario "Every column of a process-manager table is declared" */
    it("exposes or omits every column of the model", () => {
      const postgres = EVENT_TABLE_DECLARATIONS.filter(({ store }) => store === "postgres");

      expect(postgres).toHaveLength(4);
      for (const declaration of postgres) {
        const declared = Object.entries(declaration.columns).map(sourceOf).toSorted();
        expect(declared, declaration.view).toEqual(
          Object.values(MODEL_FIELDS[declaration.sourceTable]!).toSorted(),
        );
      }
    });
  });

  describe("when the declarations are read", () => {
    /** @scenario "The declarations carry no access gate" */
    it("names no permission anywhere", () => {
      expect(JSON.stringify(EVENT_TABLE_DECLARATIONS)).not.toMatch(/access|:view|:manage/);
    });
  });
});

describe("EVENT_TABLES", () => {
  describe("when the list is read", () => {
    /** @scenario "The event-table list names every table eventing owns, by store and category" */
    it("names the event log and the four process-manager tables by store and category", () => {
      expect(EVENT_TABLES).toEqual([
        { table: "event_log", store: "clickhouse", category: "event-log" },
        { table: "ProcessManagerInstance", store: "postgres", category: "process-manager" },
        { table: "ProcessManagerInbox", store: "postgres", category: "process-manager" },
        { table: "ProcessManagerOutbox", store: "postgres", category: "process-manager" },
        { table: "ProcessManagerOutboxAttempt", store: "postgres", category: "process-manager" },
      ]);
    });
  });
});
