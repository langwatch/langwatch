import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  classifyEventLogRowRetention,
  EVENT_LOG_INDEFINITE_RETENTION_SQL_PREDICATE,
  eventLogRetentionCategoryFromMutationCommand,
  eventLogRetentionCategoryMutationMarkerSql,
  eventLogRetentionCategorySqlPredicate,
} from "../event-log-retention-policy";

describe("event log retention policy", () => {
  describe.each([
    ["authz_grant", "lw.authz.grant.attached"],
    ["authz_role", "lw.authz.role.defined"],
    ["user_identity", "lw.identity.identifier_attached"],
    ["sso_connection", "lw.identity.connection_registered"],
    ["join_request", "lw.identity.join_requested"],
    ["scim_sync", "lw.identity.scim_token_issued"],
    ["governance_subject", "lw.governance.vk_lifecycle"],
  ])("for %s", (aggregateType, eventType) => {
    it("retains the security event indefinitely", () => {
      expect(
        classifyEventLogRowRetention({
          AggregateType: aggregateType,
          EventType: eventType,
        }),
      ).toBe("indefinite");
    });
  });

  it("uses security event types as a safety net for legacy aggregate rows", () => {
    expect(
      classifyEventLogRowRetention({
        AggregateType: "historical_identity_aggregate",
        EventType: "lw.identity.historical_event",
      }),
    ).toBe("indefinite");
    expect(
      classifyEventLogRowRetention({
        AggregateType: "historical_authz_aggregate",
        EventType: "lw.authz.historical_event",
      }),
    ).toBe("indefinite");
    expect(
      classifyEventLogRowRetention({
        AggregateType: "historical_governance_aggregate",
        EventType: "lw.governance.vk_lifecycle",
      }),
    ).toBe("indefinite");
  });

  describe.each([
    ["trace", "lw.obs.trace.span_received", "traces"],
    ["log", "lw.obs.log.record_received", "traces"],
    ["metric", "lw.obs.metric.data_point_received", "traces"],
    ["evaluation", "lw.eval.evaluation.completed", "traces"],
    ["langy_conversation", "lw.langy_conversation.message_recorded", "traces"],
    ["topic_clustering", "lw.obs.topic_clustering.topics_recorded", "traces"],
    ["gateway_request", "lw.gateway.spend.confirmed", "traces"],
    ["pulled_usage", "lw.obs.pulled_usage.observed", "traces"],
    ["ingestion_pull", "lw.obs.ingestion_pull.run_completed", "traces"],
    ["trigger", "lw.automation.trigger.match_recorded", "traces"],
    ["coding_agent_session", "lw.obs.coding_agent_session.span_facts_contributed", "traces"],
    ["governance_subject", "lw.governance.budget_crossing", "traces"],
    ["billing_report", "lw.billing_report.historical_event", "traces"],
    ["global", "lw.maintenance.historical_event", "traces"],
    ["simulation_run", "lw.simulation_run.started", "scenarios"],
    ["simulation_set", "lw.simulation_set.archived", "scenarios"],
    ["suite_run", "lw.suite_run.started", "scenarios"],
    ["experiment_run", "lw.experiment_run.started", "experiments"],
  ])("for %s", (aggregateType, eventType, expectedCategory) => {
    it("keeps policy-bound rows on their customer retention category", () => {
      expect(
        classifyEventLogRowRetention({
          AggregateType: aggregateType,
          EventType: eventType,
        }),
      ).toBe(expectedCategory);
    });
  });

  it.each(["unknown_historical_aggregate", "constructor", "toString", "__proto__"])(
    "treats the unknown aggregate key %s as traces",
    (AggregateType) => {
      expect(
        classifyEventLogRowRetention({
          AggregateType,
          EventType: "legacy.event",
        }),
      ).toBe("traces");
    },
  );

  it("derives the indefinite ClickHouse predicate from the same policy", () => {
    expect(EVENT_LOG_INDEFINITE_RETENTION_SQL_PREDICATE).toBe(
      "(startsWith(EventType, 'lw.identity.') OR startsWith(EventType, 'lw.authz.') OR " +
        "EventType IN ('lw.governance.vk_lifecycle') OR " +
        "AggregateType IN ('authz_grant', 'authz_role', 'user_identity', 'sso_connection', " +
        "'join_request', 'scim_sync'))",
    );
  });

  it("keeps the operational backfill aligned with the ingestion predicate", () => {
    const runbook = readFileSync(
      new URL(
        "../../../../../../dev/docs/runbooks/security-event-retention-backfill.md",
        import.meta.url,
      ),
      "utf8",
    );
    const normaliseSql = (sql: string) =>
      sql
        .replace(/\s+/g, " ")
        .replace(/\(\s+/g, "(")
        .replace(/\s+\)/g, ")")
        .replace(/,\s+/g, ",");

    expect(normaliseSql(runbook)).toContain(
      normaliseSql(EVENT_LOG_INDEFINITE_RETENTION_SQL_PREDICATE),
    );
  });

  it("derives disjoint ClickHouse predicates for finite categories", () => {
    const traces = eventLogRetentionCategorySqlPredicate("traces");
    const scenarios = eventLogRetentionCategorySqlPredicate("scenarios");
    const experiments = eventLogRetentionCategorySqlPredicate("experiments");

    for (const predicate of [traces, scenarios, experiments]) {
      expect(predicate).toContain(`NOT ${EVENT_LOG_INDEFINITE_RETENTION_SQL_PREDICATE}`);
    }
    expect(traces).toContain(
      "AggregateType NOT IN ('experiment_run', 'simulation_run', 'simulation_set', 'suite_run')",
    );
    expect(scenarios).toContain(
      "AggregateType IN ('simulation_run', 'simulation_set', 'suite_run')",
    );
    expect(experiments).toContain("AggregateType IN ('experiment_run')");
  });

  it.each(["traces", "scenarios", "experiments"] as const)(
    "round-trips the %s mutation marker from a stored ClickHouse command",
    (category) => {
      const markerSql = eventLogRetentionCategoryMutationMarkerSql(category);
      const command = `UPDATE _retention_days = 49 WHERE ${markerSql}`;

      expect(markerSql).toContain(`'langwatch:event-log-retention-category:${category}'`);
      expect(eventLogRetentionCategoryFromMutationCommand(command)).toBe(category);
    },
  );

  it("rejects absent or ambiguous mutation markers", () => {
    const ambiguousCommand = [
      eventLogRetentionCategoryMutationMarkerSql("traces"),
      eventLogRetentionCategoryMutationMarkerSql("scenarios"),
    ].join(" AND ");

    expect(eventLogRetentionCategoryFromMutationCommand(undefined)).toBeNull();
    expect(eventLogRetentionCategoryFromMutationCommand("UPDATE without marker")).toBeNull();
    expect(eventLogRetentionCategoryFromMutationCommand(ambiguousCommand)).toBeNull();
  });
});
