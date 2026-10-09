// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import {
  CODING_ASSISTANT_BILLING_AGGREGATE_TYPE,
  codingAssistantBillingAggregateId,
} from "@langwatch/enterprise-governance-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import {
  createTenantId,
  EventSourcing,
  type ReplayEventSource,
  ReplayService,
} from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { LogApi } from "@langwatch/log-contract";
import type { MetricApi } from "@langwatch/metric-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import type { TraceApi } from "@langwatch/trace-contract";
import {
  isMigrationStep,
  type MigrationStep,
  type MigrationStepReport,
} from "@langwatch/upgrade/step";
import type { UserApi } from "@langwatch/user-contract";
import type { WebhookApi } from "@langwatch/webhook-contract";

import { governanceProcessModule } from "../../governance.module.ts";

/** Organization's id list over a fixed install, a page of `pageSize` at a time. */
export function organizationIdPages({
  ids,
  pageSize,
  refusePage,
}: {
  ids: readonly string[];
  pageSize: number;
  refusePage?: number;
}) {
  const asked: { after?: string | undefined; limit?: number | undefined }[] = [];
  const listAllIds: OrganizationApi["listAllIds"] = async (input = {}) => {
    asked.push({ ...input });
    if (refusePage !== undefined && asked.length === refusePage) {
      throw Object.assign(new Error("organization ids unavailable"), { code: "ids_unavailable" });
    }
    const start = input.after === undefined ? 0 : ids.indexOf(input.after) + 1;
    const page = ids.slice(start, start + pageSize);
    const isLast = start + pageSize >= ids.length;
    return { ids: page, next: isLast ? null : (page.at(-1) ?? null) };
  };
  return { asked, organization: createApiFixture<OrganizationApi>({ listAllIds }) };
}

/** The replay engine a worker opens, over a stand-in event log and a memory Redis. */
function replayEngineOver(eventSource: ReplayEventSource) {
  return () => ({
    service: new ReplayService({
      eventSource,
      redis: memoryRedisDouble({
        script: { hdel: async () => 0, hlen: async () => 0, lpush: async () => 0 },
      }),
    }),
    close: async () => void 0,
  });
}

/** A governance worker over memory twins whose billed facts land in a readable event store. */
export async function bootGovernanceWorker({
  organization = createApiFixture<OrganizationApi>(),
  replaySource,
}: {
  organization?: OrganizationApi;
  replaySource?: ReplayEventSource;
} = {}) {
  const eventStore = EventStoreMemory.createForTesting();
  const resolver = SecretsResolver.over(SecretsChain.start({ environment: {} }).withEnv());
  await resolver.preflight(Object.values(governanceProcessModule.secrets ?? {}));
  const runtime = await createApp({
    role: "worker",
    secrets: (owner, declared) => resolver.scopeTo(owner, declared),
  })
    .withModules([governanceProcessModule])
    .withStores(memoryStores())
    .withEventing(
      new EventSourcing({
        eventStore,
        executionTarget: "api",
        consumersEnabled: false,
        processManagerMode: "producer-only",
        // A worker's participation, so the charge map and the cost rollup are registered.
        participation: "consume",
        ...(replaySource === undefined ? {} : { replayEngine: replayEngineOver(replaySource) }),
      }),
    )
    .provide({
      agent: createApiFixture<AgentApi>(),
      project: createApiFixture<ProjectApi>(),
      auth: createApiFixture<AuthApi>(),
      entitlement: createApiFixture<EntitlementApi>(),
      organization,
      authz: createApiFixture<AuthzApi>(),
      scim: createApiFixture<ScimApi>(),
      "feature-flag": createApiFixture<FeatureFlagApi>(),
      trace: createApiFixture<TraceApi>(),
      "api-key": createApiFixture<ApiKeyApi>(),
      gateway: createApiFixture<GatewayApi>(),
      "enterprise-gateway": createApiFixture<EnterpriseGatewayApi>(),
      "model-provider": createApiFixture<ModelProviderApi>(),
      user: createApiFixture<UserApi>(),
      "audit-log": createApiFixture<AuditLogApi>(),
      log: createApiFixture<LogApi>(),
      metric: createApiFixture<MetricApi>(),
      webhook: createApiFixture<WebhookApi>(),
    })
    .boot();

  const step = (id: string): MigrationStep => {
    const found = runtime.migrationSteps(isMigrationStep).find((candidate) => candidate.id === id);
    if (!found) throw new Error(`governance declares no step ${id}`);
    return found;
  };

  /** Every billed answer recorded for one organisation, newest last, by source. */
  const billedFacts = async ({
    organizationId,
    sourceType,
  }: {
    organizationId: string;
    sourceType: string;
  }) => {
    const events = await eventStore.getEvents({
      aggregateId: codingAssistantBillingAggregateId({ organizationId, sourceType }),
      context: { tenantId: createTenantId(organizationId) },
      aggregateType: CODING_ASSISTANT_BILLING_AGGREGATE_TYPE,
    });
    return events.map((event) => (event.data as { billed: boolean }).billed);
  };

  return { runtime, step, billedFacts };
}

/** One run of a step, recording every checkpoint it saves. */
export async function runStep({
  step,
  resumeFrom = null,
  dryRun = false,
  signal = new AbortController().signal,
}: {
  step: MigrationStep;
  resumeFrom?: MigrationStepReport | null;
  dryRun?: boolean;
  signal?: AbortSignal;
}) {
  const saves: MigrationStepReport[] = [];
  const report = await step.run({
    checkpoint: { resumeFrom, save: async ({ report: saved }) => void saves.push(saved) },
    dryRun,
    signal,
  });
  return { report, saves };
}
