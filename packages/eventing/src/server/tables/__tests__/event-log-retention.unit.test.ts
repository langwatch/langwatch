/**
 * @see packages/eventing/specs/event-table-surfaces.feature
 */
import { describe, expect, it } from "vitest";

import { ConfigurationError, ValidationError } from "../../../services/errorHandling.ts";
import {
  EventLogRetention,
  type EventLogRetentionClassification,
  type EventLogRetentionClient,
} from "../event-log-retention.ts";

const classification: EventLogRetentionClassification = {
  categories: ["traces", "scenarios", "experiments"],
  fallbackCategory: "traces",
  indefiniteClass: "indefinite",
  classByAggregateType: {
    user_identity: "indefinite",
    trace: "traces",
    simulation_run: "scenarios",
    suite_run: "scenarios",
    experiment_run: "experiments",
  },
  indefiniteEventTypePrefixes: ["lw.identity.", "lw.authz."],
  indefiniteEventTypes: ["lw.governance.vk_lifecycle"],
};

type Statement = Parameters<EventLogRetentionClient["command"]>[0];

function retentionOver() {
  const statements: Statement[] = [];
  const retention = EventLogRetention.create({
    client: { command: async (statement) => void statements.push(statement) },
    classification,
  });
  return { retention, statements };
}

const NEVER_EXPIRING =
  "NOT (startsWith(EventType, 'lw.identity.') OR startsWith(EventType, 'lw.authz.') OR " +
  "EventType IN ('lw.governance.vk_lifecycle') OR AggregateType IN ('user_identity'))";

describe("EventLogRetention", () => {
  describe("when a category's retention is applied", () => {
    /** @scenario "A category's retention rewrites only that category's finite rows" */
    it("rewrites only that category's finite rows for the tenant, with its marker", async () => {
      const { retention, statements } = retentionOver();

      await retention.retainCategory({
        tenantId: "project-1",
        category: "scenarios",
        retentionDays: 30,
      });

      expect(statements).toEqual([
        {
          tenantId: "project-1",
          table: "event_log",
          kind: "write",
          sql:
            "ALTER TABLE event_log UPDATE _retention_days = {retentionDays:UInt16} " +
            "WHERE TenantId = {tenantId:String} AND _retention_days != {retentionDays:UInt16}" +
            ` AND (${NEVER_EXPIRING} AND AggregateType IN ('simulation_run', 'suite_run'))` +
            " AND length('langwatch:event-log-retention-category:scenarios') > 0",
          params: { tenantId: "project-1", retentionDays: 30 },
        },
      ]);
    });

    /** @scenario "The fallback category keeps every other finite category's rows out" */
    it("excludes every other finite category's aggregates from the fallback", async () => {
      const { retention, statements } = retentionOver();

      await retention.retainCategory({
        tenantId: "project-1",
        category: "traces",
        retentionDays: 7,
      });

      expect(statements[0]!.sql).toContain(
        `AND (${NEVER_EXPIRING} AND AggregateType NOT IN ('experiment_run', 'simulation_run', 'suite_run'))`,
      );
    });

    /** @scenario "Rows that never expire are never rewritten" */
    it("guards every category's rewrite with the never-expiring predicate", async () => {
      const { retention, statements } = retentionOver();

      for (const category of classification.categories) {
        await retention.retainCategory({ tenantId: "project-1", category, retentionDays: 7 });
      }

      expect(statements).toHaveLength(3);
      for (const statement of statements) expect(statement.sql).toContain(NEVER_EXPIRING);
    });
  });

  describe("when the category is not one the classification names", () => {
    /** @scenario "A category the classification does not name is refused" */
    it("refuses by name and rewrites nothing", async () => {
      const { retention, statements } = retentionOver();

      await expect(
        retention.retainCategory({ tenantId: "project-1", category: "billing", retentionDays: 7 }),
      ).rejects.toThrow(ConfigurationError);
      expect(statements).toEqual([]);
    });
  });

  describe("when the retention is not a whole number of days", () => {
    /** @scenario "A retention that is not a whole number of days is refused" */
    it.each([-1, 1.5, 65_536])("refuses %s days and rewrites nothing", async (retentionDays) => {
      const { retention, statements } = retentionOver();

      await expect(
        retention.retainCategory({ tenantId: "project-1", category: "traces", retentionDays }),
      ).rejects.toThrow(ValidationError);
      expect(statements).toEqual([]);
    });
  });

  describe("when a recorded rewrite's command is read back", () => {
    /** @scenario "A rewrite's category is read back off its marker" */
    it("answers the marked category, and none for unmarked or other tables", async () => {
      const { retention, statements } = retentionOver();
      await retention.retainCategory({
        tenantId: "project-1",
        category: "experiments",
        retentionDays: 7,
      });
      const command = statements[0]!.sql;

      expect(retention.categoryOfMutation({ table: "event_log", command })).toBe("experiments");
      expect(
        retention.categoryOfMutation({ table: "event_log", command: "UPDATE _retention_days = 7" }),
      ).toBeNull();
      expect(retention.categoryOfMutation({ table: "stored_spans", command })).toBeNull();
      expect(retention.tables).toEqual(["event_log"]);
    });
  });
});
