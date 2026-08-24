/**
 * Type identifiers for all events and commands.
 * This file is separate from the main schemas/index.ts to avoid circular dependencies.
 * Domain files can import type identifiers from here without triggering schema evaluation.
 */

import {
  ENTERPRISE_AGGREGATE_TYPE_IDENTIFIERS,
  ENTERPRISE_COMMAND_TYPE_IDENTIFIERS,
  ENTERPRISE_EVENT_TYPE_IDENTIFIERS,
} from "@ee/event-sourcing/typeIdentifiers";
import {
  IDENTITY_COMMAND_TYPES,
  IDENTITY_EVENT_TYPES,
  JOIN_REQUEST_COMMAND_TYPES,
  JOIN_REQUEST_EVENT_TYPES,
  MFA_COMMAND_TYPES,
  MFA_EVENT_TYPES,
  SSO_CONNECTION_COMMAND_TYPES,
  SSO_CONNECTION_EVENT_TYPES,
} from "@langwatch/identity";
import {
  LANGY_CONVERSATION_PROCESSING_COMMAND_TYPES,
  LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
} from "@langwatch/langy";
import {
  AUTHZ_GRANTS_COMMAND_TYPES,
  AUTHZ_GRANTS_EVENT_TYPES,
} from "../pipelines/authz-grants/schemas/constants";
import {
  AUTOMATIONS_COMMAND_TYPES,
  AUTOMATIONS_EVENT_TYPES,
} from "../pipelines/automations/schemas/constants";
import { BILLING_REPORTING_COMMAND_TYPES } from "../pipelines/billing-reporting/schemas/constants";
import {
  CODING_AGENT_PROCESSING_COMMAND_TYPES,
  CODING_AGENT_PROCESSING_EVENT_TYPES,
} from "../pipelines/coding-agent-processing/schemas/constants";
import {
  EVALUATION_PROCESSING_COMMAND_TYPES,
  EVALUATION_PROCESSING_EVENT_TYPES,
} from "../pipelines/evaluation-processing/schemas/constants";
import {
  EXPERIMENT_RUN_PROCESSING_COMMAND_TYPES,
  EXPERIMENT_RUN_PROCESSING_EVENT_TYPES,
} from "../pipelines/experiment-run-processing/schemas/constants";
import {
  GATEWAY_SPEND_PROCESSING_COMMAND_TYPES,
  GATEWAY_SPEND_PROCESSING_EVENT_TYPES,
} from "../pipelines/gateway-spend-processing/schemas/constants";
import {
  GOVERNANCE_EVENTS_COMMAND_TYPES,
  GOVERNANCE_EVENTS_EVENT_TYPES,
} from "../pipelines/governance-events/schemas/constants";
import {
  LOG_PROCESSING_COMMAND_TYPES,
  LOG_PROCESSING_EVENT_TYPES,
} from "../pipelines/log-processing/schemas/constants";
import {
  METRIC_PROCESSING_COMMAND_TYPES,
  METRIC_PROCESSING_EVENT_TYPES,
} from "../pipelines/metric-processing/schemas/constants";
import {
  SIMULATION_PROCESSING_EVENT_TYPES,
  SIMULATION_RUN_PROCESSING_COMMAND_TYPES,
} from "../pipelines/simulation-processing/schemas/constants";
import {
  SUITE_RUN_PROCESSING_COMMAND_TYPES,
  SUITE_RUN_PROCESSING_EVENT_TYPES,
} from "../pipelines/suite-run-processing/schemas/constants";
import {
  TOPIC_CLUSTERING_PROCESSING_COMMAND_TYPES,
  TOPIC_CLUSTERING_PROCESSING_EVENT_TYPES,
} from "../pipelines/topic-clustering-processing/schemas/constants";
import {
  TRACE_PROCESSING_COMMAND_TYPES,
  TRACE_PROCESSING_EVENT_TYPES,
} from "../pipelines/trace-processing/schemas/constants";

/**
 * Test-only event type identifiers. Minimal brands without full schemas, used
 * only to validate the pipeline in tests: `test.integration.event` for
 * integration coverage. Staged queue payloads (what a `stage` hook returns)
 * are plain job DTOs, not events, so they need no brand here — see
 * `StagedJobPayload`.
 */
const TEST_EVENT_TYPES = ["test.integration.event"] as const;

/**
 * All event type identifiers defined in schemas.
 */
export const EVENT_TYPE_IDENTIFIERS = [
  ...AUTHZ_GRANTS_EVENT_TYPES,
  ...IDENTITY_EVENT_TYPES,
  ...MFA_EVENT_TYPES,
  ...SSO_CONNECTION_EVENT_TYPES,
  ...JOIN_REQUEST_EVENT_TYPES,
  ...AUTOMATIONS_EVENT_TYPES,
  ...TRACE_PROCESSING_EVENT_TYPES,
  ...METRIC_PROCESSING_EVENT_TYPES,
  ...LOG_PROCESSING_EVENT_TYPES,
  ...CODING_AGENT_PROCESSING_EVENT_TYPES,
  ...EVALUATION_PROCESSING_EVENT_TYPES,
  ...EXPERIMENT_RUN_PROCESSING_EVENT_TYPES,
  ...SIMULATION_PROCESSING_EVENT_TYPES,
  ...SUITE_RUN_PROCESSING_EVENT_TYPES,
  ...LANGY_CONVERSATION_PROCESSING_EVENT_TYPES,
  ...TOPIC_CLUSTERING_PROCESSING_EVENT_TYPES,
  ...ENTERPRISE_EVENT_TYPE_IDENTIFIERS,
  ...GATEWAY_SPEND_PROCESSING_EVENT_TYPES,
  ...GOVERNANCE_EVENTS_EVENT_TYPES,
  ...TEST_EVENT_TYPES,
] as const;

/**
 * All command type identifiers defined in schemas.
 */
export const COMMAND_TYPE_IDENTIFIERS = [
  ...AUTHZ_GRANTS_COMMAND_TYPES,
  ...IDENTITY_COMMAND_TYPES,
  ...MFA_COMMAND_TYPES,
  ...SSO_CONNECTION_COMMAND_TYPES,
  ...JOIN_REQUEST_COMMAND_TYPES,
  ...AUTOMATIONS_COMMAND_TYPES,
  ...TRACE_PROCESSING_COMMAND_TYPES,
  ...METRIC_PROCESSING_COMMAND_TYPES,
  ...LOG_PROCESSING_COMMAND_TYPES,
  ...CODING_AGENT_PROCESSING_COMMAND_TYPES,
  ...EVALUATION_PROCESSING_COMMAND_TYPES,
  ...EXPERIMENT_RUN_PROCESSING_COMMAND_TYPES,
  ...SIMULATION_RUN_PROCESSING_COMMAND_TYPES,
  ...SUITE_RUN_PROCESSING_COMMAND_TYPES,
  ...LANGY_CONVERSATION_PROCESSING_COMMAND_TYPES,
  ...TOPIC_CLUSTERING_PROCESSING_COMMAND_TYPES,
  ...ENTERPRISE_COMMAND_TYPE_IDENTIFIERS,
  ...BILLING_REPORTING_COMMAND_TYPES,
  ...GATEWAY_SPEND_PROCESSING_COMMAND_TYPES,
  ...GOVERNANCE_EVENTS_COMMAND_TYPES,
] as const;

/**
 * Test aggregate type identifier for integration tests.
 * Used only for validation - no full schema required.
 */
const TEST_AGGREGATE_TYPE = "test_aggregate" as const;

/**
 * Aggregate type identifiers extracted from event/command identifiers.
 * Note: "span" aggregate was removed as span storage is now handled
 * via event handler in the trace-processing pipeline.
 */
export const AGGREGATE_TYPE_IDENTIFIERS = [
  // ADR-110: a grant is its own aggregate, and so is a role. There is no
  // organization-keyed authorization aggregate.
  "authz_grant",
  "authz_role",
  "user_identity",
  // D04: a connection is its own aggregate, tenanted by the organization.
  // Separate from `user_identity` because it is keyed by a DIFFERENT thing —
  // an organization, not a person — so it cannot share that aggregate's id.
  // (Not because a pipeline may hold only one aggregate type: `trace` carries
  // spans, logs and annotations, and `user_identity` carries two-step
  // verification alongside identifiers. `storeEvents` takes the aggregate
  // type per call and validates a batch against it, #7406.)
  "sso_connection",
  // D12: a join request is its own aggregate, tenanted by the organization,
  // because the people who read one are its admins. Separate from
  // `user_identity` because of the KEY rather than the entity kind: it is
  // keyed by `joinRequestId` where the identity aggregate is keyed by user,
  // and the aggregate id is what the queue shards on.
  "join_request",
  "trigger",
  "trace",
  "metric",
  "log",
  "coding_agent_session",
  "evaluation",
  "experiment_run",
  "simulation_run",
  "simulation_set",
  "suite_run",
  "langy_conversation",
  "topic_clustering",
  ...ENTERPRISE_AGGREGATE_TYPE_IDENTIFIERS,
  "billing_report",
  "gateway_request",
  "governance_subject",
  "global",
  TEST_AGGREGATE_TYPE,
] as const;
