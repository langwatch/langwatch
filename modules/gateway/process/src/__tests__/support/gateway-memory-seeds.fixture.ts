/**
 * Rows a unit test writes through the gateway's memory twins: keys, budgets, ledger debits and
 * one request's settled spend, with every column the test does not care about defaulted.
 */
import {
  usdToNanoUsd,
  type GatewayBudget,
  type GatewayBudgetDebitRow,
  type GatewayBudgetLedgerStatus,
} from "@langwatch/gateway-contract";
import type { ProjectWithTeam } from "@langwatch/project-contract";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";

import type { GatewaySpendState } from "../../eventing/gateway-spend.projection.ts";
import type { CreateGatewayVirtualKeyInput } from "../../repositories/gateway-virtual-key.repository.ts";
import { memoryGatewayDecimal } from "../../repositories/memory/memory.gateway.store.ts";
import { EMPTY_SPEND_USAGE } from "../../rules/gateway-spend-projection.rules.ts";

/** A key on one team of its organization, named as the test names it. */
export function memoryVirtualKeySeed({
  id,
  name,
  organizationId,
}: {
  id: string;
  name: string;
  organizationId: string;
}): CreateGatewayVirtualKeyInput {
  return {
    id,
    organizationId,
    name,
    hashedSecret: `hash_${id}`,
    displayPrefix: "lw_vk_",
    config: {},
    createdById: "usr_1",
    scopes: [{ scopeType: "TEAM", scopeId: "team_1" }],
  };
}

/** One request's confirmed spend, as gateway_spend folds it. */
export function memorySpendStateSeed(
  overrides: Partial<GatewaySpendState> = {},
): GatewaySpendState {
  return {
    status: "confirmed",
    organizationId: "org_1",
    virtualKeyId: "vk_1",
    principalUserId: "",
    endUserId: "enduser-9",
    model: "gpt-5",
    providerKey: "prov_1",
    traceId: "trace_1",
    requestType: "chat",
    labels: [],
    metadataJson: "",
    podId: "",
    podSeq: 0,
    usage: { ...EMPTY_SPEND_USAGE, input_tokens: 100, output_tokens: 50 },
    rateVersion: "catalog@2026-07-26",
    costNanoUsd: 4_200_000,
    errorType: "",
    httpStatus: 200,
    needsReconciliation: false,
    settleReason: "",
    occurredAtMs: Temporal.Instant.from("2026-07-20T12:00:00Z").epochMilliseconds,
    durationMs: 900,
    createdAt: 1,
    updatedAt: 1,
    LastEventOccurredAt: 0,
    ...overrides,
  };
}

/** A live monthly $100 PROJECT budget on project_01, in a period that began an hour ago. */
export function memoryBudgetSeed(overrides: Partial<GatewayBudget> = {}): GatewayBudget {
  const now = nowInstant();
  return {
    id: "b_01",
    organizationId: "org_01",
    scopeType: "PROJECT",
    scopeId: "project_01",
    name: "monthly",
    description: null,
    window: "MONTH",
    onBreach: "BLOCK",
    limitUsd: memoryGatewayDecimal("100.00"),
    spentUsd: memoryGatewayDecimal("0.00"),
    timezone: null,
    providerKey: null,
    externalId: null,
    metadata: null,
    currentPeriodStartedAt: now.subtract({ hours: 1 }),
    resetsAt: now.add({ hours: 24 * 30 }),
    lastResetAt: null,
    cycleAnchorAt: null,
    archivedAt: null,
    createdAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    updatedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    createdById: "user_01",
    managedByVirtualKeyId: null,
    ...overrides,
  };
}

/** One request's debit against a budget's bucket (its own scope unless named), occurring now. */
export function memoryDebitSeed({
  budget,
  amountUsd,
  gatewayRequestId,
  bucketScopeId = budget.scopeId,
  tenantId = "project_01",
  status = "SUCCESS",
  occurredAt = nowInstant(),
}: {
  budget: Pick<GatewayBudget, "id" | "scopeType" | "scopeId" | "window">;
  amountUsd: string;
  gatewayRequestId: string;
  bucketScopeId?: string;
  tenantId?: string;
  status?: GatewayBudgetLedgerStatus;
  occurredAt?: Instant;
}): GatewayBudgetDebitRow {
  return {
    tenantId,
    budgetId: budget.id,
    scope: budget.scopeType,
    scopeId: bucketScopeId,
    window: budget.window,
    virtualKeyId: "vk_01",
    gatewayRequestId,
    amountNanoUsd: Number(usdToNanoUsd(amountUsd)),
    tokensInput: 0,
    tokensOutput: 0,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    model: "gpt-5-mini",
    status,
    occurredAt,
  };
}

/** A project and its team as ProjectApi.findWithTeam answers them. */
export function memoryProjectWithTeam({
  projectId,
  teamId,
  organizationId,
}: {
  projectId: string;
  teamId: string;
  organizationId: string;
}): ProjectWithTeam {
  const at = new Date("2026-01-01T00:00:00.000Z");
  const owned = { createdAt: at, updatedAt: at, archivedAt: null, isPersonal: false };
  return {
    ...owned,
    id: projectId,
    name: projectId,
    slug: projectId,
    apiKey: "",
    lwqlKey: "",
    teamId,
    language: "python",
    framework: "openai",
    kind: "application",
    firstMessage: false,
    integrated: false,
    userLinkTemplate: null,
    traceSharingEnabled: false,
    presenceEnabled: false,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
    team: {
      ...owned,
      id: teamId,
      name: teamId,
      slug: teamId,
      organizationId,
      ownerUserId: null,
      departmentId: null,
    },
  };
}
