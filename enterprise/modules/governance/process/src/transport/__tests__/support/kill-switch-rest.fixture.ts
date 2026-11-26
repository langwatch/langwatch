/**
 * The kill switch REST family over the real governance application, memory repositories and the
 * `agent_stop` pipeline in memory. Two organisation keys: the trace rule's and the on-call's.
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import {
  canonicalErrorResponse,
  createRestRuntime,
  recordOrganizationCredential,
} from "@langwatch/api/rest";
import type { AuditLogApi, RecordAuditLogCommand } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi, GatewayVirtualKeyDisableCommand } from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import type { LogApi } from "@langwatch/log-contract";
import type { MetricApi } from "@langwatch/metric-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { Temporal } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { WebhookApi } from "@langwatch/webhook-contract";

import { GovernanceModule } from "../../../app/governance.app.ts";
import { virtualKey } from "../../../features/kill-switch/services/__tests__/kill-switch.fixtures.ts";
import type { RegistryDraft } from "../../../features/registry/rules/registry-entry.rules.ts";
import { planRegistryChanges } from "../../../features/registry/rules/registry-reconcile.rules.ts";
import { MemoryGovernanceRepositories } from "../../../repositories/memory/memory.governance.repositories.ts";
import { agentKillSwitchRest } from "../../agent-kill-switch.rest.ts";

export const ORG = "org-1";
export const AGENT_ID = "agent-support-bot";
export const VIRTUAL_KEY_ID = "vk-support-bot";
/** The bearer each key presents, and the API key id and owner the door records for it. */
export const KEYS = {
  traceRule: { bearer: "lw_org_trace_rule", apiKeyId: "key-trace-rule", userId: "user-owner" },
  onCall: { bearer: "lw_org_on_call", apiKeyId: "key-on-call", userId: "user-on-call" },
} as const;

class TestCredentialError extends HandledError {
  constructor() {
    super("unauthorized", "Invalid credential", { httpStatus: 401 });
  }
}

class TestKeyPermissionError extends HandledError {
  constructor() {
    super("forbidden", "Outside the key's ceiling", { httpStatus: 403 });
  }
}

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

function planOfType(type: string): Plan {
  return {
    planSource: "subscription",
    type,
    name: type,
    free: type === "FREE",
    maxMembers: 10,
    maxMembersLite: 10,
    maxMembersDeveloper: 0,
    maxMessagesPerMonth: 1000,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
  };
}

/** The governance application over memory; its doubles record each disable and audit row. */
async function governanceAppOf({
  repositories,
  planType,
}: {
  repositories: ReturnType<typeof MemoryGovernanceRepositories.create>;
  planType: string;
}) {
  const disabled: GatewayVirtualKeyDisableCommand[] = [];
  const audited: RecordAuditLogCommand[] = [];
  const app = await GovernanceModule.create({
    config: void 0,
    repositories,
    dependencies: {
      webhooks: createApiFixture<WebhookApi>(),
      notifications: createApiFixture<NotificationService>(),
      agents: createApiFixture<AgentApi>(),
      projects: createApiFixture<ProjectApi>(),
      auth: createApiFixture<AuthApi>(),
      entitlements: createApiFixture<EntitlementApi>({
        getActivePlan: async () => planOfType(planType),
      }),
      organizations: createApiFixture<OrganizationApi>(),
      permissions: createApiFixture<AuthzApi>(),
      scim: createApiFixture<ScimApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      traces: createApiFixture<TraceApi>(),
      apiKeys: createApiFixture<ApiKeyApi>(),
      gateway: createApiFixture<GatewayApi>({
        findVirtualKeyById: async (id) => (id === VIRTUAL_KEY_ID ? virtualKey(id) : null),
        disableVirtualKey: async (input) => {
          disabled.push(input);
          return virtualKey(input.id);
        },
        enableVirtualKey: async (input) => virtualKey(input.id),
      }),
      enterpriseGateway: createApiFixture<EnterpriseGatewayApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
      users: createApiFixture<UserApi>(),
      auditLog: createApiFixture<AuditLogApi>({
        record: async (command) => {
          audited.push(command);
          return { id: "audit", occurredAt: 0 };
        },
      }),
      logs: createApiFixture<LogApi>(),
      metrics: createApiFixture<MetricApi>(),
      retention: createApiFixture<DataRetentionApi>(),
    },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });
  return { app, disabled, audited };
}

/** The registry agent "support-bot" with a one-key stop plan. */
async function seedAgent(
  repositories: ReturnType<typeof MemoryGovernanceRepositories.create>,
): Promise<void> {
  await repositories.agentRegistry.applyChanges({
    organizationId: ORG,
    plan: (stored) =>
      planRegistryChanges({
        stored,
        drafts: [draft("support-bot")],
        now: Temporal.Instant.from("2026-11-01T00:00:00Z"),
        newId: () => AGENT_ID,
      }),
    baselineAt: Temporal.Instant.from("2026-11-01T00:00:00Z"),
  });
  await repositories.agentStopPlans.replaceTargets({
    organizationId: ORG,
    agentId: AGENT_ID,
    targets: [
      {
        id: "target-vk",
        label: `Virtual key ${VIRTUAL_KEY_ID}`,
        target: { kind: "gateway_virtual_key", virtualKeyId: VIRTUAL_KEY_ID },
      },
    ],
  });
}

/** The REST family mounted on a runtime whose keys hold `grants` and whose plan is `planType`. */
function mountKillSwitchRest({
  app,
  grants,
  planType,
  doorRows,
}: {
  app: Awaited<ReturnType<typeof governanceAppOf>>["app"];
  grants: string[];
  planType: string;
  doorRows: unknown[];
}) {
  const runtime = createRestRuntime({
    audit: { record: (row) => void doorRows.push(row) },
    authorization: restTestAuthorization(),
    entitlements: { holds: async () => planType === "ENTERPRISE" },
    identity: {
      authenticate: ({ request, permission }) => {
        const bearer = request.headers.get("Authorization")?.replace("Bearer ", "");
        const key = Object.values(KEYS).find((candidate) => candidate.bearer === bearer);
        if (!key) throw new TestCredentialError();
        if (!grants.includes(permission)) throw new TestKeyPermissionError();
        recordOrganizationCredential(request, {
          type: "apiKey-org",
          apiKeyId: key.apiKeyId,
          userId: key.userId,
          organizationId: ORG,
        });
        return {
          actor: { type: "api_key", id: key.apiKeyId },
          scope: { tier: "organization", id: ORG } as const,
        };
      },
    },
  });
  const hono = runtime.mount(agentKillSwitchRest.router(), {
    app: () => app,
    credential: "organization",
    onError: canonicalErrorResponse,
  });
  return ({
    method,
    path,
    body,
    key = KEYS.onCall,
  }: {
    method: "GET" | "POST" | "PUT";
    path: string;
    body?: string;
    key?: { bearer: string };
  }) =>
    hono.request(path, {
      method,
      headers: { Authorization: `Bearer ${key.bearer}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body }),
    });
}

export async function buildKillSwitchRest({
  grants = ["governance:view", "governance:manage"],
  planType = "ENTERPRISE",
}: { grants?: string[]; planType?: string } = {}) {
  const repositories = MemoryGovernanceRepositories.create();
  const { app, disabled, audited } = await governanceAppOf({ repositories, planType });
  await seedAgent(repositories);
  const processStore = InMemoryProcessStore.createForTesting();
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore,
  });
  const pipeline = eventing.register(app.agentStopPipeline({ processStore }));
  app.connectAgentStop(pipeline.commands);
  const doorRows: unknown[] = [];
  const call = mountKillSwitchRest({ app, grants, planType, doorRows });
  return { app, repositories, eventing, disabled, audited, doorRows, call };
}
