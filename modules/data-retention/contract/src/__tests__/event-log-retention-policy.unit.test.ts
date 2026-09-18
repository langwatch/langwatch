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
  /** @scenario "Security events are retained indefinitely" */
  describe("given a row on a security aggregate", () => {
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

  /** @scenario "Security events are retained indefinitely" */
  describe("given a row whose event type carries a security prefix", () => {
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

  /** @scenario "Non-security event families remain policy-bound" */
  it("does not extend indefinite retention to other events on the same shared aggregate", () => {
    // Budget crossings and other governance_subject events are not the
    // vk_lifecycle exception, so they age with the traces category like the
    // rest of that aggregate.
    expect(
      classifyEventLogRowRetention({
        AggregateType: "governance_subject",
        EventType: "lw.governance.budget_crossed",
      }),
    ).toBe("traces");
  });

  /** @scenario "Non-security event families remain policy-bound" */
  describe("given a row on a non-security aggregate", () => {
    it.each([
      ["trace", "traces"],
      ["log", "traces"],
      ["metric", "traces"],
      ["evaluation", "traces"],
      ["langy_conversation", "traces"],
      ["topic_clustering", "traces"],
      ["ingestion_pull", "traces"],
      ["pulled_usage", "traces"],
      ["billing_report", "traces"],
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

  /** @scenario "Event log rows use the workload's retention category" */
  describe("given a row on a scenario or experiment aggregate", () => {
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

  /** @scenario "Non-security event families remain policy-bound" */
  it("falls back to traces for an aggregate type it does not recognise", () => {
    expect(
      classifyEventLogRowRetention({
        AggregateType: "some_future_aggregate_nobody_registered_yet",
        EventType: "some.future.event",
      }),
    ).toBe("traces");
  });
});
