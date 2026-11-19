// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The agent kill switch: an agent's stop plan, the AWS connections a Bedrock target signs with,
 * and one stop's lifecycle as events on its own aggregate.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import { governanceEventEnvelopeSchema } from "../../governance.ts";

// ── Stop plan ──────────────────────────────────────────────────────────────

export const AGENT_STOP_TARGET_KINDS = [
  "databricks_serving_endpoint",
  "bedrock_agent_alias",
  "gateway_virtual_key",
] as const;
export type AgentStopTargetKind = (typeof AGENT_STOP_TARGET_KINDS)[number];

const databricksServingEndpointTargetSchemaDefinition = z.object({
  kind: z.literal("databricks_serving_endpoint"),
  /** The Databricks governance source whose workspace and credentials the call uses. */
  ingestionSourceId: z.string().min(1),
  endpointName: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[A-Za-z0-9_-]+$/, "a serving endpoint name is letters, digits, - and _"),
});
const bedrockAgentAliasTargetSchemaDefinition = z.object({
  kind: z.literal("bedrock_agent_alias"),
  awsConnectionId: z.string().min(1),
  region: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/, "an AWS region such as eu-west-1"),
  agentId: z.string().regex(/^[0-9a-zA-Z]{10}$/, "a Bedrock agent id is 10 characters"),
  agentAliasId: z.string().regex(/^[0-9a-zA-Z]{10}$/, "a Bedrock alias id is 10 characters"),
});
const gatewayVirtualKeyTargetSchemaDefinition = z.object({
  kind: z.literal("gateway_virtual_key"),
  virtualKeyId: z.string().min(1),
});

const agentStopTargetSchemaDefinition = z.discriminatedUnion("kind", [
  databricksServingEndpointTargetSchemaDefinition,
  bedrockAgentAliasTargetSchemaDefinition,
  gatewayVirtualKeyTargetSchemaDefinition,
]);
export interface AgentStopTargetSchema extends Named<typeof agentStopTargetSchemaDefinition> {}
export const agentStopTargetSchema: AgentStopTargetSchema = agentStopTargetSchemaDefinition;
export type AgentStopTarget = z.infer<typeof agentStopTargetSchema>;

/** One plan row: a target with its stable id and a label people read. */
const agentStopPlanTargetSchemaDefinition = z.object({
  id: z.string(),
  label: z.string(),
  target: agentStopTargetSchema,
});
export interface AgentStopPlanTargetSchema extends Named<
  typeof agentStopPlanTargetSchemaDefinition
> {}
export const agentStopPlanTargetSchema: AgentStopPlanTargetSchema =
  agentStopPlanTargetSchemaDefinition;
export type AgentStopPlanTarget = z.infer<typeof agentStopPlanTargetSchema>;

export const AGENT_STOP_PLAN_TARGETS_MAX = 20;

const agentStopPlanSchemaDefinition = z.object({
  agentId: z.string(),
  targets: agentStopPlanTargetSchema.array(),
  updatedAt: z.string().nullable(),
  /** Bumps on every save; 0 for an agent whose plan was never saved. */
  version: z.number().int().nonnegative(),
});
export interface AgentStopPlanSchema extends Named<typeof agentStopPlanSchemaDefinition> {}
export const agentStopPlanSchema: AgentStopPlanSchema = agentStopPlanSchemaDefinition;
export type AgentStopPlan = z.infer<typeof agentStopPlanSchema>;

/** The plan version the caller read; a save over a newer plan is refused. */
const expectedPlanVersionSchema = z.number().int().nonnegative();

const setAgentStopPlanInputSchemaDefinition = z.object({
  targets: agentStopTargetSchema.array().max(AGENT_STOP_PLAN_TARGETS_MAX),
  expectedVersion: expectedPlanVersionSchema.optional(),
});
export interface SetAgentStopPlanInputSchema extends Named<
  typeof setAgentStopPlanInputSchemaDefinition
> {}
export const setAgentStopPlanInputSchema: SetAgentStopPlanInputSchema =
  setAgentStopPlanInputSchemaDefinition;

// ── AWS connections ────────────────────────────────────────────────────────

/**
 * A static key pair, a role to assume, or both (the pair signs the AssumeRole call). LangWatch
 * generates the external id of a role; one sent here is stripped and never used.
 */
const awsConnectionInputSchemaDefinition = z
  .object({
    name: z.string().trim().min(1).max(80),
    accessKeyId: z.string().trim().min(16).max(128).optional(),
    secretAccessKey: z.string().trim().min(16).max(256).optional(),
    roleArn: z
      .string()
      .regex(/^arn:aws[a-z-]*:iam::\d{12}:role\/.+$/, "an IAM role ARN")
      .optional(),
  })
  .refine((input) => Boolean(input.accessKeyId) === Boolean(input.secretAccessKey), {
    message: "an access key id and its secret come together",
    path: ["secretAccessKey"],
  })
  .refine((input) => Boolean(input.accessKeyId) || Boolean(input.roleArn), {
    message: "an access key pair or a role ARN is required",
    path: ["roleArn"],
  });
export interface AwsConnectionInputSchema extends Named<
  typeof awsConnectionInputSchemaDefinition
> {}
export const awsConnectionInputSchema: AwsConnectionInputSchema =
  awsConnectionInputSchemaDefinition;
export type AwsConnectionInput = z.infer<typeof awsConnectionInputSchema>;

/** What a read answers: never the secret, only the access key id's last four characters. */
const awsConnectionViewSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  accessKeyIdLastFour: z.string().nullable(),
  roleArn: z.string().nullable(),
  /** Generated by LangWatch for the role's trust policy; null without a role. */
  externalId: z.string().nullable(),
  createdAt: z.string(),
});
export interface AwsConnectionViewSchema extends Named<typeof awsConnectionViewSchemaDefinition> {}
export const awsConnectionViewSchema: AwsConnectionViewSchema = awsConnectionViewSchemaDefinition;
export type AwsConnectionView = z.infer<typeof awsConnectionViewSchema>;

// ── A stop ─────────────────────────────────────────────────────────────────

export const AGENT_STOP_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type AgentStopSeverity = (typeof AGENT_STOP_SEVERITIES)[number];
/**
 * The severity a stop from the governance UI carries. A person's stop acts at once whatever its
 * severity, so the Stop dialog asks none; the audit row and the webhook payload name this one.
 */
export const GOVERNANCE_UI_STOP_SEVERITY: AgentStopSeverity = "high";

/** `user`: a person in the UI or tRPC. `api_key`: a machine credential, a trace rule's webhook included. */
export const AGENT_STOP_TRIGGERS = ["user", "api_key"] as const;
export type AgentStopTrigger = (typeof AGENT_STOP_TRIGGERS)[number];

export const AGENT_STOP_APPROVALS = ["immediate", "required"] as const;
export type AgentStopApproval = (typeof AGENT_STOP_APPROVALS)[number];

export const AGENT_STOP_STATUSES = [
  "pending_approval",
  "denied",
  "stopping",
  "quarantined",
  "stop_failed",
  "restoring",
  "restored",
  "restore_failed",
] as const;
export type AgentStopStatus = (typeof AGENT_STOP_STATUSES)[number];
/** A stop in one of these blocks a new stop of the same agent. */
export const AGENT_STOP_OPEN_STATUSES: readonly AgentStopStatus[] = [
  "pending_approval",
  "stopping",
  "quarantined",
  "stop_failed",
  "restoring",
  "restore_failed",
];
/** A stop in one of these may be restored. */
export const AGENT_STOP_RESTORABLE_STATUSES: readonly AgentStopStatus[] = [
  "quarantined",
  "stop_failed",
  "restore_failed",
];
/**
 * A stop in one of these may be retried: every target it holds that is not stopped, and every
 * plan target added since, is applied again.
 */
export const AGENT_STOP_RETRYABLE_STATUSES: readonly AgentStopStatus[] = [
  "quarantined",
  "stop_failed",
  "restore_failed",
];

export const AGENT_STOP_TARGET_STATES = [
  "pending",
  "applied",
  "failed",
  "reverting",
  "reverted",
  "revert_failed",
] as const;
export type AgentStopTargetState = (typeof AGENT_STOP_TARGET_STATES)[number];

const agentStopTargetOutcomeSchemaDefinition = z.object({
  id: z.string(),
  label: z.string(),
  target: agentStopTargetSchema,
  state: z.enum(AGENT_STOP_TARGET_STATES),
  /** A stable code (`http_403`, `ThrottlingException`, `virtual_key_not_found`), never provider prose. */
  errorCode: z.string().nullable(),
  appliedAt: z.string().nullable(),
  revertedAt: z.string().nullable(),
  /** True when the platform was already stopped before this stop; a restore leaves it as it was. */
  alreadyStopped: z.boolean().optional(),
  /** True when the cloud resource no longer exists: it counts as stopped, and as restored. */
  gone: z.boolean().optional(),
  /** On restore: a key, endpoint or alias another agent's open stop still holds, so it stayed off. */
  keptDisabled: z.boolean().optional(),
  /** Taken out of the plan: what the stop changed on it is reverted, then the target leaves the stop. */
  dropped: z.boolean().optional(),
  /** The plan change that took it out, so that revert records its own outcome. */
  dropId: z.string().optional(),
});
export interface AgentStopTargetOutcomeSchema extends Named<
  typeof agentStopTargetOutcomeSchemaDefinition
> {}
export const agentStopTargetOutcomeSchema: AgentStopTargetOutcomeSchema =
  agentStopTargetOutcomeSchemaDefinition;
export type AgentStopTargetOutcome = z.infer<typeof agentStopTargetOutcomeSchema>;

const agentStopViewSchemaDefinition = z.object({
  id: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  status: z.enum(AGENT_STOP_STATUSES),
  severity: z.enum(AGENT_STOP_SEVERITIES),
  approval: z.enum(AGENT_STOP_APPROVALS),
  trigger: z.enum(AGENT_STOP_TRIGGERS),
  reason: z.string(),
  requestedBy: z.object({ userId: z.string().nullable(), apiKeyId: z.string().nullable() }),
  decidedByUserId: z.string().nullable(),
  restoredByUserId: z.string().nullable(),
  targets: agentStopTargetOutcomeSchema.array(),
  requestedAt: z.string(),
  decidedAt: z.string().nullable(),
  quarantinedAt: z.string().nullable(),
  restoreRequestedAt: z.string().nullable(),
  restoredAt: z.string().nullable(),
  /** The last restore or retry request the stop accepted; a caller polls the stop for its own. */
  lastRequestId: z.string().optional(),
});
export interface AgentStopViewSchema extends Named<typeof agentStopViewSchemaDefinition> {}
export const agentStopViewSchema: AgentStopViewSchema = agentStopViewSchemaDefinition;
export type AgentStopView = z.infer<typeof agentStopViewSchema>;

/** The plan target ids the caller confirmed; a stop is refused when the plan no longer matches. */
const expectedTargetIdsSchema = z.string().min(1).array().max(AGENT_STOP_PLAN_TARGETS_MAX);

const requestAgentStopInputSchemaDefinition = z.object({
  reason: z.string().trim().min(1).max(2000),
  severity: z.enum(AGENT_STOP_SEVERITIES).default("high"),
  expectedTargetIds: expectedTargetIdsSchema.optional(),
});
export interface RequestAgentStopInputSchema extends Named<
  typeof requestAgentStopInputSchemaDefinition
> {}
export const requestAgentStopInputSchema: RequestAgentStopInputSchema =
  requestAgentStopInputSchemaDefinition;

const decideAgentStopInputSchemaDefinition = z.object({
  note: z.string().trim().max(2000).optional(),
});
export interface DecideAgentStopInputSchema extends Named<
  typeof decideAgentStopInputSchemaDefinition
> {}
export const decideAgentStopInputSchema: DecideAgentStopInputSchema =
  decideAgentStopInputSchemaDefinition;

/** An approval names the stop's target ids the approver saw; a stop that changed since is refused. */
const approveAgentStopInputSchemaDefinition = z.object({
  ...decideAgentStopInputSchemaDefinition.shape,
  expectedTargetIds: expectedTargetIdsSchema.optional(),
});
export interface ApproveAgentStopInputSchema extends Named<
  typeof approveAgentStopInputSchemaDefinition
> {}
export const approveAgentStopInputSchema: ApproveAgentStopInputSchema =
  approveAgentStopInputSchemaDefinition;

/** A retry takes no fields: it applies again what the stop has not stopped. */
const retryAgentStopInputSchemaDefinition = z.object({});
export interface RetryAgentStopInputSchema extends Named<
  typeof retryAgentStopInputSchemaDefinition
> {}
export const retryAgentStopInputSchema: RetryAgentStopInputSchema =
  retryAgentStopInputSchemaDefinition;

/** A restore takes no fields: it reverts what the stop applied. */
const restoreAgentStopInputSchemaDefinition = z.object({});
export interface RestoreAgentStopInputSchema extends Named<
  typeof restoreAgentStopInputSchemaDefinition
> {}
export const restoreAgentStopInputSchema: RestoreAgentStopInputSchema =
  restoreAgentStopInputSchemaDefinition;

// ── REST (`/api/governance/agents/:agentId/stop*`, `/api/governance/agent-stops`) ──

const agentStopAgentParamsSchemaDefinition = z.object({ agentId: z.string().min(1) });
export interface AgentStopAgentParamsSchema extends Named<
  typeof agentStopAgentParamsSchemaDefinition
> {}
export const agentStopAgentParamsSchema: AgentStopAgentParamsSchema =
  agentStopAgentParamsSchemaDefinition;

const agentStopParamsSchemaDefinition = z.object({ stopId: z.string().min(1) });
export interface AgentStopParamsSchema extends Named<typeof agentStopParamsSchemaDefinition> {}
export const agentStopParamsSchema: AgentStopParamsSchema = agentStopParamsSchemaDefinition;

export const AGENT_STOP_PAGE_LIMIT_MAX = 200;

const agentStopListQuerySchemaDefinition = z.object({
  status: z.enum(AGENT_STOP_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(AGENT_STOP_PAGE_LIMIT_MAX).default(50),
  cursor: z.string().min(1).optional(),
});
export interface AgentStopListQuerySchema extends Named<
  typeof agentStopListQuerySchemaDefinition
> {}
export const agentStopListQuerySchema: AgentStopListQuerySchema =
  agentStopListQuerySchemaDefinition;

const agentStopPlanResponseSchemaDefinition = z.object({ data: agentStopPlanSchema });
export interface AgentStopPlanResponseSchema extends Named<
  typeof agentStopPlanResponseSchemaDefinition
> {}
export const agentStopPlanResponseSchema: AgentStopPlanResponseSchema =
  agentStopPlanResponseSchemaDefinition;

const agentStopResponseSchemaDefinition = z.object({ data: agentStopViewSchema });
export interface AgentStopResponseSchema extends Named<typeof agentStopResponseSchemaDefinition> {}
export const agentStopResponseSchema: AgentStopResponseSchema = agentStopResponseSchemaDefinition;

const agentStopListResponseSchemaDefinition = z.object({
  data: agentStopViewSchema.array(),
  /** Pass back as `cursor`; null when the page was the last. */
  next_cursor: z.string().nullable(),
});
export interface AgentStopListResponseSchema extends Named<
  typeof agentStopListResponseSchemaDefinition
> {}
export const agentStopListResponseSchema: AgentStopListResponseSchema =
  agentStopListResponseSchemaDefinition;
export type AgentStopPage = z.infer<typeof agentStopListResponseSchema>;

// ── Events (aggregate `agent_stop`, one per stop) ──────────────────────────

export const AGENT_STOP_AGGREGATE_TYPE = "agent_stop" as const;
export const AGENT_STOP_EVENT_TYPES = {
  REQUESTED: "lw.governance.agent_stop.requested",
  APPROVED: "lw.governance.agent_stop.approved",
  DENIED: "lw.governance.agent_stop.denied",
  TARGET_APPLIED: "lw.governance.agent_stop.target_applied",
  TARGET_FAILED: "lw.governance.agent_stop.target_failed",
  RESTORE_REQUESTED: "lw.governance.agent_stop.restore_requested",
  TARGET_REVERTED: "lw.governance.agent_stop.target_reverted",
  TARGET_REVERT_FAILED: "lw.governance.agent_stop.target_revert_failed",
  RETRY_REQUESTED: "lw.governance.agent_stop.retry_requested",
  TARGETS_DROPPED: "lw.governance.agent_stop.targets_dropped",
} as const;
export const AGENT_STOP_EVENT_VERSION = "2026-11-16" as const;
export const AGENT_STOP_COMMAND_TYPES = {
  REQUEST: "lw.governance.agent_stop.request",
  APPROVE: "lw.governance.agent_stop.approve",
  DENY: "lw.governance.agent_stop.deny",
  RECORD_TARGET_APPLIED: "lw.governance.agent_stop.record_target_applied",
  RECORD_TARGET_FAILED: "lw.governance.agent_stop.record_target_failed",
  REQUEST_RESTORE: "lw.governance.agent_stop.request_restore",
  RECORD_TARGET_REVERTED: "lw.governance.agent_stop.record_target_reverted",
  RECORD_TARGET_REVERT_FAILED: "lw.governance.agent_stop.record_target_revert_failed",
  RETRY: "lw.governance.agent_stop.retry",
  DROP_TARGETS: "lw.governance.agent_stop.drop_targets",
} as const;

const stopRef = { stopId: z.string().min(1), organizationId: z.string().min(1) };

const agentStopRequestedEventDataSchemaDefinition = z.object({
  ...stopRef,
  agentId: z.string().min(1),
  agentName: z.string(),
  severity: z.enum(AGENT_STOP_SEVERITIES),
  approval: z.enum(AGENT_STOP_APPROVALS),
  trigger: z.enum(AGENT_STOP_TRIGGERS),
  reason: z.string(),
  requestedByUserId: z.string().nullable(),
  requestedByApiKeyId: z.string().nullable(),
  /** The plan as it stood at request; a target later removed from the plan leaves the stop. */
  targets: agentStopPlanTargetSchema.array().min(1),
});
export interface AgentStopRequestedEventDataSchema extends Named<
  typeof agentStopRequestedEventDataSchemaDefinition
> {}
export const agentStopRequestedEventDataSchema: AgentStopRequestedEventDataSchema =
  agentStopRequestedEventDataSchemaDefinition;
export type AgentStopRequestedEventData = z.infer<typeof agentStopRequestedEventDataSchema>;

const agentStopDecidedEventDataSchemaDefinition = z.object({
  ...stopRef,
  decidedByUserId: z.string().nullable(),
  decidedByApiKeyId: z.string().nullable(),
  note: z.string().nullable(),
  /** The decision the API advanced the row by; absent on decisions sent before it did. */
  requestId: z.string().optional(),
});
export interface AgentStopDecidedEventDataSchema extends Named<
  typeof agentStopDecidedEventDataSchemaDefinition
> {}
export const agentStopDecidedEventDataSchema: AgentStopDecidedEventDataSchema =
  agentStopDecidedEventDataSchemaDefinition;
export type AgentStopDecidedEventData = z.infer<typeof agentStopDecidedEventDataSchema>;

const agentStopTargetSettledEventDataSchemaDefinition = z.object({
  ...stopRef,
  targetId: z.string().min(1),
  errorCode: z.string().nullable(),
  /** On an applied outcome: the platform was already stopped, so nothing was changed. */
  alreadyStopped: z.boolean().optional(),
  /** The cloud resource no longer exists, so there was nothing to stop or restore. */
  gone: z.boolean().optional(),
  /** On a revert outcome: the target stayed off for another agent's open stop. */
  keptDisabled: z.boolean().optional(),
  /** On a revert outcome: the restore it answers, so a second restore records its own outcome. */
  restoreRound: z.number().int().positive().optional(),
  /** On an apply outcome: the retry it answers, absent for the stop's first run. */
  retryRound: z.number().int().positive().optional(),
  /** On a revert outcome: the plan change whose revert it answers, absent for a restore's. */
  dropId: z.string().min(1).optional(),
});
export interface AgentStopTargetSettledEventDataSchema extends Named<
  typeof agentStopTargetSettledEventDataSchemaDefinition
> {}
export const agentStopTargetSettledEventDataSchema: AgentStopTargetSettledEventDataSchema =
  agentStopTargetSettledEventDataSchemaDefinition;
export type AgentStopTargetSettledEventData = z.infer<typeof agentStopTargetSettledEventDataSchema>;

const agentStopRestoreRequestedEventDataSchemaDefinition = z.object({
  ...stopRef,
  requestedByUserId: z.string().nullable(),
  requestedByApiKeyId: z.string().nullable(),
  /** One per restore request, so two requests never share a key; the fold numbers the round. */
  requestId: z.string().min(1),
});
export interface AgentStopRestoreRequestedEventDataSchema extends Named<
  typeof agentStopRestoreRequestedEventDataSchemaDefinition
> {}
export const agentStopRestoreRequestedEventDataSchema: AgentStopRestoreRequestedEventDataSchema =
  agentStopRestoreRequestedEventDataSchemaDefinition;
export type AgentStopRestoreRequestedEventData = z.infer<
  typeof agentStopRestoreRequestedEventDataSchema
>;

const agentStopRetryRequestedEventDataSchemaDefinition = z.object({
  ...stopRef,
  requestedByUserId: z.string().nullable(),
  requestedByApiKeyId: z.string().nullable(),
  /** One per retry request, so two requests never share a key; the fold numbers the round. */
  requestId: z.string().min(1),
  /** Plan targets the stop did not hold yet; they are applied with the ones it failed to stop. */
  targets: agentStopPlanTargetSchema.array(),
});
export interface AgentStopRetryRequestedEventDataSchema extends Named<
  typeof agentStopRetryRequestedEventDataSchemaDefinition
> {}
export const agentStopRetryRequestedEventDataSchema: AgentStopRetryRequestedEventDataSchema =
  agentStopRetryRequestedEventDataSchemaDefinition;
export type AgentStopRetryRequestedEventData = z.infer<
  typeof agentStopRetryRequestedEventDataSchema
>;

const agentStopTargetsDroppedEventDataSchemaDefinition = z.object({
  ...stopRef,
  /** The stop's targets the plan no longer holds. */
  targetIds: z.string().min(1).array().min(1),
  /** One per plan change, so each drop records once. */
  dropId: z.string().min(1),
});
export interface AgentStopTargetsDroppedEventDataSchema extends Named<
  typeof agentStopTargetsDroppedEventDataSchemaDefinition
> {}
export const agentStopTargetsDroppedEventDataSchema: AgentStopTargetsDroppedEventDataSchema =
  agentStopTargetsDroppedEventDataSchemaDefinition;
export type AgentStopTargetsDroppedEventData = z.infer<
  typeof agentStopTargetsDroppedEventDataSchema
>;

const event = governanceEventEnvelopeSchema.safeExtend({
  aggregateType: z.literal(AGENT_STOP_AGGREGATE_TYPE),
  version: z.literal(AGENT_STOP_EVENT_VERSION),
});
export const agentStopRequestedEventSchema = event.safeExtend({
  type: z.literal(AGENT_STOP_EVENT_TYPES.REQUESTED),
  data: agentStopRequestedEventDataSchema,
});
export const agentStopApprovedEventSchema = event.safeExtend({
  type: z.literal(AGENT_STOP_EVENT_TYPES.APPROVED),
  data: agentStopDecidedEventDataSchema,
});
export const agentStopDeniedEventSchema = event.safeExtend({
  type: z.literal(AGENT_STOP_EVENT_TYPES.DENIED),
  data: agentStopDecidedEventDataSchema,
});
export const agentStopTargetAppliedEventSchema = event.safeExtend({
  type: z.literal(AGENT_STOP_EVENT_TYPES.TARGET_APPLIED),
  data: agentStopTargetSettledEventDataSchema,
});
export const agentStopTargetFailedEventSchema = event.safeExtend({
  type: z.literal(AGENT_STOP_EVENT_TYPES.TARGET_FAILED),
  data: agentStopTargetSettledEventDataSchema,
});
export const agentStopRestoreRequestedEventSchema = event.safeExtend({
  type: z.literal(AGENT_STOP_EVENT_TYPES.RESTORE_REQUESTED),
  data: agentStopRestoreRequestedEventDataSchema,
});
export const agentStopTargetRevertedEventSchema = event.safeExtend({
  type: z.literal(AGENT_STOP_EVENT_TYPES.TARGET_REVERTED),
  data: agentStopTargetSettledEventDataSchema,
});
export const agentStopTargetRevertFailedEventSchema = event.safeExtend({
  type: z.literal(AGENT_STOP_EVENT_TYPES.TARGET_REVERT_FAILED),
  data: agentStopTargetSettledEventDataSchema,
});
export const agentStopRetryRequestedEventSchema = event.safeExtend({
  type: z.literal(AGENT_STOP_EVENT_TYPES.RETRY_REQUESTED),
  data: agentStopRetryRequestedEventDataSchema,
});
export const agentStopTargetsDroppedEventSchema = event.safeExtend({
  type: z.literal(AGENT_STOP_EVENT_TYPES.TARGETS_DROPPED),
  data: agentStopTargetsDroppedEventDataSchema,
});

/** The webhook and audit names of a stop's milestones, pushed to webhooks by the registry. */
export const AGENT_STOP_WEBHOOK_EVENT_TYPES = [
  "governance.agent.stop_requested",
  "governance.agent.quarantined",
  "governance.agent.stop_failed",
  "governance.agent.restored",
  "governance.agent.restore_failed",
] as const;
export type AgentStopWebhookEventType = (typeof AGENT_STOP_WEBHOOK_EVENT_TYPES)[number];

/**
 * Who asked: a person (userId only), or an organisation API key (its id and its owner, if any).
 * `impersonatorId` names the operator behind an impersonated person, as the generic trail does.
 */
export type AgentStopCaller = {
  userId: string | null;
  apiKeyId: string | null;
  impersonatorId?: string;
};

// ── tRPC (the governance UI) ───────────────────────────────────────────────

const organizationScope = { organizationId: z.string() };
const agentScope = { ...organizationScope, agentId: z.string().min(1) };
const stopScope = { ...organizationScope, stopId: z.string().min(1) };

/** One Agents-page row's kill switch state, keyed by the row's registry entry. */
const agentKillSwitchSummarySchemaDefinition = z.object({
  agentId: z.string(),
  /** The Agents-page row id this registry entry backs (`registered:<id>` or `discovered:<id>`). */
  inventoryRowId: z.string().nullable(),
  planTargetCount: z.number().int().nonnegative(),
  openStop: agentStopViewSchema.nullable(),
});
export interface AgentKillSwitchSummarySchema extends Named<
  typeof agentKillSwitchSummarySchemaDefinition
> {}
export const agentKillSwitchSummarySchema: AgentKillSwitchSummarySchema =
  agentKillSwitchSummarySchemaDefinition;
export type AgentKillSwitchSummary = z.infer<typeof agentKillSwitchSummarySchema>;

/** Every stop event, hinted to the stop's organisation: a stop's progress changes both reads. */
const AGENT_STOP_READ_HINTS = Object.values(AGENT_STOP_EVENT_TYPES).map((event) => ({
  event,
  scope: "organizationId",
}));

export const governanceKillSwitchTrpc = defineTrpcContract("governanceKillSwitch")
  .query("summaries", { invalidatedBy: AGENT_STOP_READ_HINTS })
  .withInput(z.object(organizationScope))
  .withOutput(agentKillSwitchSummarySchema.array())

  .query("pendingApprovals", { invalidatedBy: AGENT_STOP_READ_HINTS })
  .withInput(z.object(organizationScope))
  .withOutput(agentStopViewSchema.array())

  .query("plan")
  .withInput(z.object(agentScope))
  .withOutput(agentStopPlanSchema)

  .mutation("setPlan")
  .withInput(
    z.object({
      ...agentScope,
      targets: setAgentStopPlanInputSchema.shape.targets,
      expectedVersion: expectedPlanVersionSchema.optional(),
    }),
  )
  .withOutput(agentStopPlanSchema)

  .query("awsConnections")
  .withInput(z.object(organizationScope))
  .withOutput(awsConnectionViewSchema.array())

  .mutation("createAwsConnection")
  .withInput(z.object({ ...organizationScope, connection: awsConnectionInputSchema }))
  .withOutput(awsConnectionViewSchema)

  .mutation("deleteAwsConnection")
  .withInput(z.object({ ...organizationScope, connectionId: z.string().min(1) }))
  .withOutput(z.object({ deleted: z.boolean() }))

  .mutation("requestStop")
  .withInput(
    z.object({
      ...agentScope,
      reason: z.string().trim().min(1).max(2000),
      expectedTargetIds: expectedTargetIdsSchema.optional(),
    }),
  )
  .withOutput(agentStopViewSchema)

  .mutation("approveStop")
  .withInput(
    z.object({
      ...stopScope,
      note: z.string().trim().max(2000).optional(),
      expectedTargetIds: expectedTargetIdsSchema.optional(),
    }),
  )
  .withOutput(agentStopViewSchema)

  .mutation("denyStop")
  .withInput(z.object({ ...stopScope, note: z.string().trim().max(2000).optional() }))
  .withOutput(agentStopViewSchema)

  .mutation("restore")
  .withInput(z.object(stopScope))
  .withOutput(agentStopViewSchema)

  .mutation("retryStop")
  .withInput(z.object(stopScope))
  .withOutput(agentStopViewSchema)
  .build();
