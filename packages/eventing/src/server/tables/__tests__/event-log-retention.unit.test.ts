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
type Question = Parameters<EventLogRetentionClient["query"]>[0];

/** A routed member whose server holds the id index only when `holdsIdIndex` says so. */
function retentionOver({ holdsIdIndex = false }: { holdsIdIndex?: boolean } = {}) {
  const statements: Statement[] = [];
  const questions: Question[] = [];
  const retention = EventLogRetention.create({
    client: {
      command: async (statement) => void statements.push(statement),
      query: async (question) => {
        questions.push(question);
        return { rows: holdsIdIndex ? [{ name: "event_log_id_index" }] : [] };
      },
    },
    classification,
  });
  return { retention, statements, questions };
}

const NEVER_EXPIRING_EVENT_TYPES =
  "NOT (startsWith(EventType, 'lw.identity.') OR startsWith(EventType, 'lw.authz.') OR " +
  "EventType IN ('lw.governance.vk_lifecycle'))";

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
            ` AND (${NEVER_EXPIRING_EVENT_TYPES} AND AggregateType IN ('simulation_run', 'suite_run'))` +
            " AND length('langwatch:event-log-retention-category:scenarios') > 0",
          params: { tenantId: "project-1", retentionDays: 30 },
        },
      ]);
    });

    /** @scenario "An aggregate type mapped to no category is never rewritten" */
    it("rewrites only the aggregate types the category lists, never an unlisted one", async () => {
      const { retention, statements } = retentionOver();

      await retention.retainCategory({
        tenantId: "project-1",
        category: "traces",
        retentionDays: 7,
      });

      expect(statements[0]!.sql).toContain(
        `AND (${NEVER_EXPIRING_EVENT_TYPES} AND AggregateType IN ('trace'))`,
      );
      expect(statements[0]!.sql).not.toContain("NOT IN");
    });

    /** @scenario "Rows that never expire are never rewritten" */
    it("guards every category's rewrite with the never-expiring predicate", async () => {
      const { retention, statements } = retentionOver();

      for (const category of classification.categories) {
        await retention.retainCategory({ tenantId: "project-1", category, retentionDays: 7 });
      }

      expect(statements).toHaveLength(3);
      for (const statement of statements)
        expect(statement.sql).toContain(NEVER_EXPIRING_EVENT_TYPES);
    });
  });

  describe("when the never-expiring rows are kept forever", () => {
    /** @scenario "Every never-expiring row on a target is re-stamped to be kept forever" */
    it("re-stamps every tenant's never-expiring rows on the routed target to 0 days", async () => {
      const { retention, statements } = retentionOver();

      await retention.keepIndefiniteRows({ organizationId: "org-private" });

      expect(statements).toEqual([
        {
          tenantId: "",
          organizationId: "org-private",
          table: "event_log",
          kind: "write",
          sql:
            "ALTER TABLE event_log UPDATE _retention_days = 0 WHERE _retention_days != 0 AND " +
            "(startsWith(EventType, 'lw.identity.') OR startsWith(EventType, 'lw.authz.') OR " +
            "EventType IN ('lw.governance.vk_lifecycle') OR " +
            "AggregateType NOT IN ('experiment_run', 'simulation_run', 'suite_run', 'trace'))" +
            " AND length('langwatch:event-log-retention-category:indefinite') > 0",
          // The retention TTL is one rule over every tenant's events.
          SKIP_TENANT_CHECK: true,
        },
      ]);
      expect(
        retention.categoryOfMutation({ table: "event_log", command: statements[0]!.sql }),
      ).toBe("indefinite");
    });

    it("targets the shared server when no organization is named", async () => {
      const { retention, statements } = retentionOver();

      await retention.keepIndefiniteRows({});

      expect(statements[0]).not.toHaveProperty("organizationId");
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
      expect(retention.tables).toEqual(["event_log", "event_log_id_index"]);
    });

    it("answers the marked category for the id index's own rewrite", async () => {
      const { retention, statements } = retentionOver({ holdsIdIndex: true });
      await retention.retainCategory({
        tenantId: "project-1",
        category: "traces",
        retentionDays: 7,
      });

      expect(
        retention.categoryOfMutation({ table: "event_log_id_index", command: statements[1]!.sql }),
      ).toBe("traces");
    });
  });

  describe("when the target holds the event log's id index", () => {
    it("raises the tenant's index rows in the category, never lowering one", async () => {
      const { retention, statements } = retentionOver({ holdsIdIndex: true });

      const tables = await retention.retainCategory({
        tenantId: "project-1",
        category: "scenarios",
        retentionDays: 30,
      });

      expect(tables).toEqual(["event_log", "event_log_id_index"]);
      expect(statements[1]).toEqual({
        tenantId: "project-1",
        table: "event_log_id_index",
        kind: "write",
        sql:
          "ALTER TABLE event_log_id_index UPDATE _retention_days = {retentionDays:UInt16} " +
          "WHERE TenantId = {tenantId:String} AND _retention_days < {retentionDays:UInt16}" +
          " AND AggregateType IN ('simulation_run', 'suite_run')" +
          " AND length('langwatch:event-log-retention-category:scenarios') > 0",
        params: { tenantId: "project-1", retentionDays: 30 },
      });
    });

    it("writes a category kept forever as the index's highest retention", async () => {
      const { retention, statements } = retentionOver({ holdsIdIndex: true });

      await retention.retainCategory({
        tenantId: "project-1",
        category: "traces",
        retentionDays: 0,
      });

      expect(statements[0]!.params).toEqual({ tenantId: "project-1", retentionDays: 0 });
      expect(statements[1]!.params).toEqual({ tenantId: "project-1", retentionDays: 65_535 });
    });

    it("raises to kept forever unclassified aggregate types and aggregates holding a kept-forever event", async () => {
      const { retention, statements } = retentionOver({ holdsIdIndex: true });

      await retention.keepIndefiniteRows({ organizationId: "org-private" });

      expect(statements[1]).toEqual({
        tenantId: "",
        organizationId: "org-private",
        table: "event_log_id_index",
        kind: "write",
        sql:
          "ALTER TABLE event_log_id_index UPDATE _retention_days = 65535 " +
          "WHERE _retention_days < 65535" +
          " AND (AggregateType NOT IN ('experiment_run', 'simulation_run', 'suite_run', 'trace')" +
          " OR (TenantId, AggregateType, AggregateId) IN (SELECT TenantId, AggregateType, AggregateId" +
          " FROM event_log WHERE AggregateType IN ('experiment_run', 'simulation_run', 'suite_run', 'trace')" +
          " AND (startsWith(EventType, 'lw.identity.') OR startsWith(EventType, 'lw.authz.') OR" +
          " EventType IN ('lw.governance.vk_lifecycle'))))" +
          " AND length('langwatch:event-log-retention-category:indefinite') > 0",
        settings: { allow_nondeterministic_mutations: 1 },
        // The index's keep-forever raise is one rewrite per target, across every tenant on it.
        SKIP_TENANT_CHECK: true,
      });
    });
  });

  describe("when the target does not hold the id index yet", () => {
    it("rewrites the event log alone and skips the index", async () => {
      const { retention, statements, questions } = retentionOver();

      const tables = await retention.retainCategory({
        tenantId: "project-1",
        category: "traces",
        retentionDays: 7,
      });
      await retention.keepIndefiniteRows({});

      expect(tables).toEqual(["event_log"]);
      expect(statements.map(({ table }) => table)).toEqual(["event_log", "event_log"]);
      expect(questions[0]).toMatchObject({
        tenantId: "project-1",
        table: "system.tables",
        params: { table: "event_log_id_index" },
      });
    });
  });

  describe("when a target's id index is raised to each tenant's retention", () => {
    const retentionByTenant = new Map([
      ["project-a", { traces: 30, scenarios: 0, experiments: 30 }],
      ["project-b", { traces: 30, scenarios: 63, experiments: 30 }],
    ]);

    it("raises each category's rows in one statement, each tenant to its own days, kept forever as the highest", async () => {
      const { retention, statements } = retentionOver({ holdsIdIndex: true });

      const tables = await retention.raiseIdIndexRetention({
        organizationId: "org-private",
        retentionByTenant,
      });

      expect(tables).toEqual(["event_log_id_index"]);
      expect(
        statements.map(({ sql, params }) => ({
          aggregates: /AggregateType (NOT )?IN \(([^)]*)\)/.exec(sql)?.[0],
          params,
        })),
      ).toEqual([
        {
          aggregates: "AggregateType IN ('trace')",
          params: { tenantIds: ["project-a", "project-b"], retentionDays: [30, 30] },
        },
        {
          aggregates: "AggregateType IN ('simulation_run', 'suite_run')",
          params: { tenantIds: ["project-a", "project-b"], retentionDays: [65_535, 63] },
        },
        {
          aggregates: "AggregateType IN ('experiment_run')",
          params: { tenantIds: ["project-a", "project-b"], retentionDays: [30, 30] },
        },
        {
          aggregates:
            "AggregateType NOT IN ('experiment_run', 'simulation_run', 'suite_run', 'trace')",
          params: undefined,
        },
      ]);
      for (const statement of statements) {
        expect(statement).toMatchObject({
          organizationId: "org-private",
          // Each raise covers the target's tenants at once, which span organizations.
          SKIP_TENANT_CHECK: true,
        });
        expect(statement.sql).toContain("_retention_days < 65535");
      }
      for (const statement of statements.slice(0, 3)) {
        expect(statement.sql).toContain(
          "UPDATE _retention_days = greatest(_retention_days, transform(TenantId, " +
            "{tenantIds:Array(String)}, {retentionDays:Array(UInt16)}, _retention_days))",
        );
      }
    });

    it("runs nothing on a target that does not hold the index yet", async () => {
      const { retention, statements } = retentionOver();

      await expect(retention.raiseIdIndexRetention({ retentionByTenant })).resolves.toEqual([]);
      expect(statements).toEqual([]);
    });

    it("refuses a retention that is not a whole number of days before any rewrite", async () => {
      const { retention, statements } = retentionOver({ holdsIdIndex: true });

      await expect(
        retention.raiseIdIndexRetention({
          retentionByTenant: new Map([["project-a", { traces: 1.5 }]]),
        }),
      ).rejects.toThrow(ValidationError);
      expect(statements).toEqual([]);
    });
  });
});
