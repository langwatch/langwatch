import type { RetentionCategory } from "./data-retention.ts";

/**
 * `event_log` mixes rows with different retention needs — a trace event next
 * to a durable identity record that must never expire — so classification is
 * per-row by aggregate type, falling back to event-type prefix, never table-wide.
 */
export type EventLogRetentionClass = RetentionCategory | "indefinite";

/**
 * Security event-type prefixes that must remain durable even if an old or
 * malformed row carries an unexpected aggregate type — the safety net behind
 * normal aggregate classification for identity and authorisation history.
 */
export const INDEFINITE_EVENT_TYPE_PREFIXES = ["lw.identity.", "lw.authz."] as const;

/**
 * Never-expiring events on an aggregate that otherwise expires: security facts, configuration
 * and once-only milestones, beside the per-trace or per-run rows that age out (Alex, 2026-10-09).
 */
export const INDEFINITE_EVENT_TYPES = [
  "lw.governance.vk_lifecycle",
  "lw.automation.report_schedule.configured",
  "lw.automation.report_schedule.paused",
  "lw.automation.report_schedule.resumed",
  "lw.trace.first_trace_recorded",
  "lw.evaluation.ran",
  "lw.obs.ingestion_pull.configured",
  "lw.obs.ingestion_pull.disabled",
] as const;

/**
 * Every aggregate type this deployment's event-sourcing runtime registers, assigned its class.
 * Only customer telemetry expires (Alex, 2026-10-09); an unlisted aggregate is kept forever, and
 * the worker's installation test refuses one missing here, so telemetry must opt in.
 */
export const RETENTION_CLASS_BY_AGGREGATE_TYPE: Record<string, EventLogRetentionClass> = {
  // Customer telemetry: span, log and metric content, LLM inputs and outputs, judged results.
  trace: "traces",
  log: "traces",
  metric: "traces",
  coding_agent_session: "traces",
  evaluation: "traces",
  trace_collector_evaluation: "traces",
  langy_conversation: "traces",
  topic_clustering: "traces",
  gateway_request: "traces",
  trigger: "traces",
  trace_project_milestone: "traces",
  evaluation_lifecycle: "traces",
  instant_eval_run: "traces",
  pulled_usage: "traces",
  webhook_spend_delivery: "traces",
  ingestion_pull: "traces",
  experiment_run: "experiments",
  simulation_run: "scenarios",
  simulation_set: "scenarios",
  suite_run: "scenarios",
  // Everything else: lifecycle, configuration, billing, authz, identity, governance, meters.
  agent: "indefinite",
  annotation: "indefinite",
  authz_aggregate_read: "indefinite",
  authz_grant: "indefinite",
  authz_member_offboarded: "indefinite",
  billing_lifecycle: "indefinite",
  billing_report: "indefinite",
  coding_assistant_billing: "indefinite",
  dataset: "indefinite",
  entitlement_organization: "indefinite",
  evaluator: "indefinite",
  experiment_lifecycle: "indefinite",
  gateway_connect_managed_key: "indefinite",
  github_installation: "indefinite",
  global: "indefinite",
  governance_subject: "indefinite",
  guided_onboarding: "indefinite",
  instant_eval_judge_spend: "indefinite",
  join_request: "indefinite",
  langy_guided_onboarding: "indefinite",
  licensing_customer: "indefinite",
  nurturing_signal: "indefinite",
  organization: "indefinite",
  organization_audit: "indefinite",
  organization_seat_limit: "indefinite",
  platform_operator_seed: "indefinite",
  project: "indefinite",
  projection_replay: "indefinite",
  prompt: "indefinite",
  scenario: "indefinite",
  scim_directory_move: "indefinite",
  scim_member: "indefinite",
  scim_sso_connection_view: "indefinite",
  scim_sync: "indefinite",
  sso_connection: "indefinite",
  system_migration_pass: "indefinite",
  user: "indefinite",
  user_account: "indefinite",
  user_identity: "indefinite",
  workflow: "indefinite",
};

/**
 * Classifies one `event_log` row for retention, checked in order: event-type prefix, the
 * never-expiring event types, then the aggregate map. An unlisted aggregate is `"indefinite"`.
 */
export function classifyEventLogRowRetention(row: {
  AggregateType: string;
  EventType: string;
}): EventLogRetentionClass {
  if (INDEFINITE_EVENT_TYPE_PREFIXES.some((prefix) => row.EventType.startsWith(prefix))) {
    return "indefinite";
  }

  if (INDEFINITE_EVENT_TYPES.some((eventType) => row.EventType === eventType)) {
    return "indefinite";
  }

  return Object.hasOwn(RETENTION_CLASS_BY_AGGREGATE_TYPE, row.AggregateType)
    ? RETENTION_CLASS_BY_AGGREGATE_TYPE[row.AggregateType]!
    : "indefinite";
}
