import { describe, expect, it } from "vitest";

import {
  classifyEventLogRowRetention,
  type EventLogRetentionClass,
} from "../event-log-retention-policy.ts";

/**
 * `event_log` cannot be classified table-wide: one row is a trace event, the
 * next is durable identity/authorization history that must never expire. See
 * specs/data-retention/ingestion-stamping.feature.
 */
describe("classifyEventLogRowRetention", () => {
  describe("given a row on a security aggregate", () => {
    /** @scenario "Security events are retained indefinitely" */
    it.each([
      ["authz_grant", "lw.authz.grant.attached"],
      ["user_identity", "lw.identity.user.created"],
      ["sso_connection", "lw.identity.sso_connection.configured"],
      ["join_request", "lw.identity.join_request.submitted"],
      ["scim_sync", "lw.identity.record_scim_user_push"],
    ] as const)("classifies %s as indefinite", (aggregateType, eventType) => {
      expect(
        classifyEventLogRowRetention({ AggregateType: aggregateType, EventType: eventType }),
      ).toBe("indefinite");
    });
  });

  describe("given a row whose event type carries a security prefix", () => {
    /** @scenario "Security events are retained indefinitely" */
    it.each([
      ["lw.identity.mfa.enrolled", "trace"],
      ["lw.identity.passkey.registered", "unknown_future_aggregate"],
      ["lw.authz.role.defined", "trace"],
      ["lw.authz.grant.revoked", "unknown_future_aggregate"],
    ])(
      "classifies %s as indefinite even off an unexpected or ordinary aggregate (%s)",
      (eventType, aggregateType) => {
        expect(
          classifyEventLogRowRetention({ AggregateType: aggregateType, EventType: eventType }),
        ).toBe("indefinite");
      },
    );

    // The safety net exists precisely for a malformed or historical row whose
    // aggregate is wrong or missing — the prefix still protects it.
    it("classifies a row with an empty aggregate type as indefinite off the prefix alone", () => {
      expect(
        classifyEventLogRowRetention({ AggregateType: "", EventType: "lw.authz.role.defined" }),
      ).toBe("indefinite");
    });
  });

  /** @scenario "Security events are retained indefinitely" */
  it("classifies the virtual-key lifecycle event as indefinite on the shared governance_subject aggregate", () => {
    expect(
      classifyEventLogRowRetention({
        AggregateType: "governance_subject",
        EventType: "lw.governance.vk_lifecycle",
      }),
    ).toBe("indefinite");
  });

  describe("given a row of customer telemetry", () => {
    /** @scenario "Customer telemetry event families remain policy-bound" */
    it.each([
      ["trace", "traces"],
      ["log", "traces"],
      ["metric", "traces"],
      ["evaluation", "traces"],
      ["trace_collector_evaluation", "traces"],
      ["langy_conversation", "traces"],
      ["topic_clustering", "traces"],
      ["gateway_request", "traces"],
      ["coding_agent_session", "traces"],
      ["trigger", "traces"],
    ] as [string, EventLogRetentionClass][])(
      "classifies %s under its own workload category (%s)",
      (aggregateType, expected) => {
        expect(
          classifyEventLogRowRetention({
            AggregateType: aggregateType,
            EventType: "some.ordinary.event",
          }),
        ).toBe(expected);
      },
    );
  });

  describe("given a row that is not customer telemetry", () => {
    /** @scenario "Every other event family is retained indefinitely" */
    it.each([
      ["organization", "lw.organization.signed_up"],
      ["project", "lw.project.created"],
      ["user_account", "lw.user.created"],
      ["prompt", "lw.prompt.created"],
      ["workflow", "lw.workflow.version_saved"],
      ["billing_lifecycle", "lw.billing.subscription_started"],
      ["entitlement_organization", "lw.entitlement.month_counted"],
      ["governance_subject", "lw.governance.budget_crossing"],
      ["pulled_usage", "lw.obs.pulled_usage.observed"],
      ["ingestion_pull", "lw.obs.ingestion_pull.configured"],
      ["billing_report", "some.ordinary.event"],
      ["trigger", "lw.automation.report_schedule.configured"],
    ])("classifies %s (%s) as indefinite", (aggregateType, eventType) => {
      expect(
        classifyEventLogRowRetention({ AggregateType: aggregateType, EventType: eventType }),
      ).toBe("indefinite");
    });

    /** @scenario "Customer telemetry event families remain policy-bound" */
    it("keeps a trigger's per-trace matches with the traces category", () => {
      expect(
        classifyEventLogRowRetention({
          AggregateType: "trigger",
          EventType: "lw.automation.trigger.match_recorded",
        }),
      ).toBe("traces");
    });
  });

  describe("given a row on a scenario or experiment aggregate", () => {
    /** @scenario "Event log rows use the workload's retention category" */
    it.each([
      ["simulation_run", "scenarios"],
      ["simulation_set", "scenarios"],
      ["suite_run", "scenarios"],
      ["experiment_run", "experiments"],
    ] as [string, EventLogRetentionClass][])(
      "classifies %s under %s",
      (aggregateType, expected) => {
        expect(
          classifyEventLogRowRetention({
            AggregateType: aggregateType,
            EventType: "some.ordinary.event",
          }),
        ).toBe(expected);
      },
    );
  });

  /** @scenario "An aggregate type the policy does not list is retained indefinitely" */
  it("keeps an aggregate type it does not recognise forever", () => {
    expect(
      classifyEventLogRowRetention({
        AggregateType: "some_future_aggregate_nobody_registered_yet",
        EventType: "some.future.event",
      }),
    ).toBe("indefinite");
  });
});
