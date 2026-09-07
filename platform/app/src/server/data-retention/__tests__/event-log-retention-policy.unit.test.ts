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
    ["gateway_request", "lw.gateway.spend.confirmed"],
    ["pulled_usage", "lw.obs.pulled_usage.observed"],
    ["ingestion_pull", "lw.obs.ingestion_pull.run_completed"],
    ["trigger", "lw.automation.trigger.match_recorded"],
    ["coding_agent_session", "lw.obs.coding_agent_session.span_facts_contributed"],
  ])("for %s", (aggregateType, eventType) => {
    it("retains the durable event family indefinitely", () => {
      expect(
        classifyEventLogRowRetention({
          AggregateType: aggregateType,
          EventType: eventType,
        }),
      ).toBe("indefinite");
    });
  });

  it("uses event prefixes as a safety net for legacy control-plane rows", () => {
    expect(
      classifyEventLogRowRetention({
        AggregateType: "historical_identity_aggregate",
        EventType: "lw.identity.historical_event",
      }),
    ).toBe("indefinite");
    expect(
      classifyEventLogRowRetention({
        AggregateType: "historical_governance_aggregate",
        EventType: "lw.governance.historical_event",
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
    ["billing_report", "lw.billing_report.historical_event", "traces"],
    ["global", "lw.maintenance.historical_event", "traces"],
    ["simulation_run", "lw.simulation_run.started", "scenarios"],
    ["simulation_set", "lw.simulation_set.archived", "scenarios"],
    ["suite_run", "lw.suite_run.started", "scenarios"],
    ["experiment_run", "lw.experiment_run.started", "experiments"],
  ])("for %s", (aggregateType, eventType, expectedCategory) => {
    it("keeps payload-bearing rows on their customer retention category", () => {
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
    expect(EVENT_LOG_INDEFINITE_RETENTION_SQL_PREDICATE).toContain(
      "startsWith(EventType, 'lw.identity.')",
    );
    expect(EVENT_LOG_INDEFINITE_RETENTION_SQL_PREDICATE).toContain(
      "startsWith(EventType, 'lw.authz.')",
    );
    expect(EVENT_LOG_INDEFINITE_RETENTION_SQL_PREDICATE).toContain(
      "startsWith(EventType, 'lw.governance.')",
    );
    expect(EVENT_LOG_INDEFINITE_RETENTION_SQL_PREDICATE).toContain("'coding_agent_session'");
    expect(EVENT_LOG_INDEFINITE_RETENTION_SQL_PREDICATE).toContain("'gateway_request'");
    expect(EVENT_LOG_INDEFINITE_RETENTION_SQL_PREDICATE).not.toContain("'langy_conversation'");
    expect(EVENT_LOG_INDEFINITE_RETENTION_SQL_PREDICATE).not.toContain("'topic_clustering'");
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
