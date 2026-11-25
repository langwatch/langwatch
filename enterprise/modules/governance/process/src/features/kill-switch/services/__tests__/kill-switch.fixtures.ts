/**
 * One organisation's kill switch over memory: the registry agent "support-bot", a Databricks
 * source, an AWS connection, a virtual key, the real `agent_stop` pipeline in memory and memory
 * platforms.
 */
import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import type {
  AgentStopCaller,
  AgentStopTarget,
  AgentStopView,
  AgentStopWebhookEventType,
} from "@langwatch/enterprise-governance-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type {
  GatewayApi,
  GatewayVirtualKeyCommand,
  GatewayVirtualKeyDisableCommand,
  GatewayVirtualKeyRecord,
} from "@langwatch/gateway-contract";
import type { Logger } from "@langwatch/observability";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";

import { MemoryBedrockAgentAliasChannel } from "../../../../channels/memory/memory.bedrock-agent-alias.channel.ts";
import { MemoryDatabricksServingEndpointChannel } from "../../../../channels/memory/memory.databricks-serving-endpoint.channel.ts";
import { MemoryProviderSignInChannel } from "../../../../channels/memory/memory.provider-sign-in.channel.ts";
import { MemoryGovernanceRepositories } from "../../../../repositories/memory/memory.governance.repositories.ts";
import { SourceCredentialAccessService } from "../../../ingestion-source/services/source-credential-access.service.ts";
import { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "../../../microsoft/rules/dataverse-environment-service.rules.ts";
import type { RegistryDraft } from "../../../registry/rules/registry-entry.rules.ts";
import { planRegistryChanges } from "../../../registry/rules/registry-reconcile.rules.ts";
import { buildAgentStopPipeline } from "../../eventing/agent-stop.pipeline.ts";
import { AgentStopClaimService } from "../agent-stop-claim.service.ts";
import { AgentStopPlanService } from "../agent-stop-plan.service.ts";
import { AgentStopTargetService } from "../agent-stop-target.service.ts";
import { AgentStopService } from "../agent-stop.service.ts";
import { GovernanceAwsConnectionService } from "../governance-aws-connection.service.ts";
import { KillSwitchAuditService } from "../kill-switch-audit.service.ts";

export const ORG = "org-1";
export const AGENT_ID = "agent-support-bot";
export const WORKSPACE = "https://acme.cloud.databricks.com";
export const WORKSPACE_TOKEN = "dapi-workspace-token";
export const VIRTUAL_KEY_ID = "vk-support-bot";
export const PERSON: AgentStopCaller = { userId: "user-ops", apiKeyId: null };
export const MACHINE: AgentStopCaller = { userId: "user-key-owner", apiKeyId: "key-trace-rule" };
export const OTHER_MACHINE: AgentStopCaller = { userId: "user-oncall", apiKeyId: "key-oncall" };

function draft(name: string): RegistryDraft {
  const seen = Temporal.Instant.from("2026-11-01T00:00:00Z");
  return {
    sourceKey: `langwatch:${name}`,
    source: "langwatch",
    management: "managed",
    shadow: false,
    dormant: false,
    platform: null,
    labels: {},
    owner_label: null,
    kind: "signature",
    name,
    description: null,
    source_version: null,
    project_id: "project-1",
    environment: null,
    owner: null,
    endpoints: [],
    model: null,
    instructions: null,
    capabilities: ["signature"],
    tools: [],
    firstSeenAt: seen,
    lastSeenAt: null,
  };
}

export function virtualKey(id: string): GatewayVirtualKeyRecord {
  const at = Temporal.Instant.from("2026-11-01T00:00:00Z");
  return {
    id,
    organizationId: ORG,
    name: "support-bot",
    description: null,
    status: "ACTIVE",
    purpose: "USER",
    externalId: null,
    metadata: null,
    disabledAt: null,
    disabledReason: null,
    expiresAt: null,
    hashedSecret: "hash",
    displayPrefix: "lw_vk_",
    principalUserId: null,
    traceProjectId: null,
    config: null,
    revision: 1n,
    previousHashedSecret: null,
    previousSecretValidUntil: null,
    revokedAt: null,
    revokedById: null,
    createdAt: at,
    updatedAt: at,
    createdById: "user-ops",
    lastUsedAt: null,
    routingPolicyId: null,
    routingMode: "NONE",
    scopes: [],
    principalUser: null,
    routingPolicy: null,
  };
}

export type VirtualKeyCall =
  | { action: "disable"; input: GatewayVirtualKeyDisableCommand }
  | { action: "enable"; input: GatewayVirtualKeyCommand };

/**
 * `otherAgents` registers more agents beside "support-bot", each with the id `agent-<name>`;
 * `pageSize` is how many rows the stop service reads at a time.
 */
export async function killSwitchHarness({
  maxAttempts = 3,
  otherAgents = [],
  pageSize,
  logger,
}: {
  maxAttempts?: number;
  otherAgents?: readonly string[];
  pageSize?: number;
  logger?: Logger;
} = {}) {
  const repositories = MemoryGovernanceRepositories.create();
  const names = ["support-bot", ...otherAgents];
  for (const [index, name] of names.entries()) {
    const id = index === 0 ? AGENT_ID : `agent-${name}`;
    await repositories.agentRegistry.applyChanges({
      organizationId: ORG,
      plan: (stored) =>
        planRegistryChanges({
          stored,
          drafts: names.slice(0, index + 1).map(draft),
          now: Temporal.Instant.from("2026-11-01T00:00:00Z"),
          newId: () => id,
        }),
      baselineAt: Temporal.Instant.from("2026-11-01T00:00:00Z"),
    });
  }
  const source = await repositories.ingestionSources.create({
    organizationId: ORG,
    teamId: null,
    traceProjectId: null,
    sourceType: "databricks_genie",
    name: "Databricks",
    description: null,
    ingestSecretHash: "unused",
    parserConfig: {
      adapter: "databricks_genie",
      workspaceUrl: WORKSPACE,
      credentials: { token: WORKSPACE_TOKEN },
    },
    pullSchedule: null,
    status: "awaiting_first_event",
    createdById: "user-ops",
    providerAccountId: null,
  });
  const copilotSource = await repositories.ingestionSources.create({
    organizationId: ORG,
    teamId: null,
    traceProjectId: null,
    sourceType: COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
    name: "Copilot Studio",
    description: null,
    ingestSecretHash: "unused",
    parserConfig: { environmentUrl: "https://acme.crm.dynamics.com" },
    pullSchedule: null,
    status: "awaiting_first_event",
    createdById: "user-ops",
    providerAccountId: null,
  });

  const audit: RecordAuditLogCommand[] = [];
  const auditLog = createApiFixture<AuditLogApi>({
    // As the audit log does: a repeated idempotency key writes nothing and answers the first row.
    record: async (command) => {
      const first = command.idempotencyKey
        ? audit.findIndex((row) => row.idempotencyKey === command.idempotencyKey)
        : -1;
      if (first < 0) audit.push(command);
      return { id: `audit-${first < 0 ? audit.length : first + 1}`, occurredAt: 0 };
    },
  });
  const virtualKeyCalls: VirtualKeyCall[] = [];
  const keyRefusals = new Map<string, string>();
  /** A key's current status; absent means ACTIVE. A disable or enable that succeeds changes it. */
  const keyStatuses = new Map<string, GatewayVirtualKeyRecord["status"]>();
  const keyDisabledAt = new Map<string, GatewayVirtualKeyRecord["disabledAt"]>();
  const refuseKey = (code: string) => {
    const error = new Error(code);
    Object.assign(error, { code });
    return error;
  };
  const gateway = createApiFixture<GatewayApi>({
    findVirtualKeyById: async (id, organizationId) =>
      id === VIRTUAL_KEY_ID && organizationId === ORG
        ? {
            ...virtualKey(id),
            status: keyStatuses.get(id) ?? "ACTIVE",
            disabledAt: keyDisabledAt.get(id) ?? null,
          }
        : null,
    disableVirtualKey: async (input) => {
      virtualKeyCalls.push({ action: "disable", input });
      const code = keyRefusals.get("disable");
      if (code) throw refuseKey(code);
      keyStatuses.set(input.id, "DISABLED");
      keyDisabledAt.set(input.id, Temporal.Now.instant());
      return virtualKey(input.id);
    },
    enableVirtualKey: async (input) => {
      virtualKeyCalls.push({ action: "enable", input });
      const code = keyRefusals.get("enable");
      if (code) throw refuseKey(code);
      keyStatuses.set(input.id, "ACTIVE");
      keyDisabledAt.delete(input.id);
      return virtualKey(input.id);
    },
  });
  const announced: {
    milestone: AgentStopWebhookEventType;
    eventId: string;
    occurredAt: number;
    stop: AgentStopView;
  }[] = [];

  const servingEndpoints = MemoryDatabricksServingEndpointChannel.create();
  const bedrock = MemoryBedrockAgentAliasChannel.create();
  bedrock.seed({
    agentId: "AGENT00001",
    agentAliasId: "ALIAS00001",
    alias: {
      agentAliasName: "live",
      description: "support-bot live alias",
      routingConfiguration: [{ agentVersion: "7" }],
      aliasInvocationState: "ACCEPT_INVOCATIONS",
    },
  });
  // The service writes each row at once under its key; the pipeline's audit outbox stays empty.
  const killSwitchAudit = KillSwitchAuditService.create({ auditLog, outbox: () => undefined });
  const connections = GovernanceAwsConnectionService.create({
    connections: repositories.awsConnections,
    plans: repositories.agentStopPlans,
    stops: repositories.agentStops,
    audit: killSwitchAudit,
  });
  const connection = await connections.createConnection({
    organizationId: ORG,
    userId: "user-ops",
    connection: {
      name: "ACME production",
      accessKeyId: "AKIAACMEEXAMPLE0001",
      secretAccessKey: "acme-secret-access-key-0001",
    },
  });
  // The trail a test reads starts after the harness's own setup writes.
  audit.length = 0;

  const eventStore = EventStoreMemory.createForTesting();
  const processStore = InMemoryProcessStore.createForTesting();
  const eventing = new EventSourcing({ eventStore, processStore });
  let commands: Record<string, { send(payload: unknown): Promise<unknown> }> = {};
  /** How many more times recording each target's outcome is refused, by target id. */
  const recordRefusals = new Map<string, number>();
  const send = async (name: string, payload: unknown) => {
    const targetId = (payload as { targetId?: string }).targetId;
    const refusals = targetId ? (recordRefusals.get(targetId) ?? 0) : 0;
    if (name.startsWith("recordTarget") && targetId && refusals > 0) {
      recordRefusals.set(targetId, refusals - 1);
      throw new Error(`seeded refusal recording ${targetId}`);
    }
    const sender = commands[name];
    if (!sender) throw new Error(`no ${name} command`);
    await sender.send(payload);
  };
  const sourceCredentials = SourceCredentialAccessService.create({
    sources: repositories.ingestionSources,
  });
  const signIn = MemoryProviderSignInChannel.create();
  // Plan saves probe the platforms on channels of their own, so stop-path calls stay countable.
  const probes = {
    servingEndpoints: MemoryDatabricksServingEndpointChannel.create(),
    bedrock: MemoryBedrockAgentAliasChannel.create(),
  };
  probes.bedrock.seed({
    agentId: "AGENT00001",
    agentAliasId: "ALIAS00001",
    alias: {
      agentAliasName: "live",
      description: "support-bot live alias",
      routingConfiguration: [{ agentVersion: "7" }],
      aliasInvocationState: "ACCEPT_INVOCATIONS",
    },
  });
  const plans = AgentStopPlanService.create({
    plans: repositories.agentStopPlans,
    registry: repositories.agentRegistry,
    sources: repositories.ingestionSources,
    awsConnections: repositories.awsConnections,
    virtualKeys: gateway,
    sourceCredentials,
    signIn,
    servingEndpoints: probes.servingEndpoints,
    bedrock: probes.bedrock,
  });
  const stops = AgentStopService.create({
    stops: repositories.agentStops,
    claims: AgentStopClaimService.create({
      claims: repositories.agentStopClaims,
      stops: repositories.agentStops,
    }),
    plans,
    locks: repositories.killSwitchLock,
    registry: repositories.agentRegistry,
    audit: killSwitchAudit,
    send,
    ...(pageSize ? { pageSize } : {}),
  });
  const targets = AgentStopTargetService.create({
    send,
    sourceCredentials,
    signIn,
    servingEndpoints,
    awsConnections: repositories.awsConnections,
    priorStates: repositories.agentStopTargetPriorStates,
    bedrock,
    virtualKeys: gateway,
    plans,
    locks: repositories.killSwitchLock,
    registry: {
      announceStop: async (input) => {
        announced.push(input);
        return { id: input.eventId } as never;
      },
    },
    stops: repositories.agentStops,
    auditLog,
    maxAttempts,
    ...(logger ? { logger } : {}),
  });
  const pipeline = eventing.register(
    buildAgentStopPipeline({
      store: repositories.agentStops,
      executors: targets,
      audit: { record: (intent) => auditLog.record(intent).then(() => undefined), processStore },
      retryDelayMs: () => 0,
    }),
  );
  commands = pipeline.commands;

  const fullPlan: AgentStopTarget[] = [
    {
      kind: "databricks_serving_endpoint",
      ingestionSourceId: source.id,
      endpointName: "support-bot-prod",
    },
    {
      kind: "bedrock_agent_alias",
      awsConnectionId: connection.id,
      region: "eu-west-1",
      agentId: "AGENT00001",
      agentAliasId: "ALIAS00001",
    },
    { kind: "gateway_virtual_key", virtualKeyId: VIRTUAL_KEY_ID },
  ];
  const setFullPlan = () =>
    plans.setPlan({ organizationId: ORG, agentId: AGENT_ID, targets: fullPlan });
  const stopOf = (stopId: string) =>
    repositories.agentStops.getStop({ organizationId: ORG, stopId });

  return {
    repositories,
    eventStore,
    eventing,
    pipeline,
    plans,
    stops,
    targets,
    connections,
    connection,
    source,
    copilotSource,
    servingEndpoints,
    bedrock,
    probes,
    audit,
    announced,
    virtualKeyCalls,
    keyRefusals,
    keyStatuses,
    recordRefusals,
    fullPlan,
    setFullPlan,
    stopOf,
  };
}
