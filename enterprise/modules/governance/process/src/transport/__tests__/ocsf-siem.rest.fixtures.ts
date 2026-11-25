/**
 * The OCSF SIEM door over the real governance application and memory repositories: the three
 * export streams, access, paging, filters and the push-in. Spec: specs/ocsf-siem.feature
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import type { AuditLogApi, AuditLogExportEntry } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { HandledError } from "@langwatch/handled-error";
import type { LogApi } from "@langwatch/log-contract";
import type { MetricApi } from "@langwatch/metric-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import type { InternalProject, ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { Temporal } from "@langwatch/time";
import type { TraceApi, TraceSummaryData } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { WebhookApi } from "@langwatch/webhook-contract";

import { GovernanceModule } from "../../app/governance.app.ts";
import type { GovernanceOcsfEvent } from "../../repositories/governance.repositories.ts";
import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { ocsfSiemRest } from "../ocsf-siem.rest.ts";

export const ORG = "org-1";
export const KEY = "org-key";
export const TENANT = "governance-project";
export const PROJECTS = ["project-a", "project-b"];

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

export const INTERNAL: InternalProject = {
  id: TENANT,
  name: "Governance",
  slug: "governance",
  teamId: "team-1",
  kind: "internal_governance",
  archivedAtMs: null,
  traceSharingEnabled: false,
};

export function governanceEvent(
  id: string,
  at: string,
  sourceType = "otel_generic",
): GovernanceOcsfEvent {
  return {
    tenantId: TENANT,
    eventId: id,
    traceId: id,
    sourceId: `src-${sourceType}`,
    sourceType,
    activityId: 6,
    severityId: 1,
    eventTime: Temporal.Instant.from(at),
    actorUserId: "user-1",
    actorEmail: "",
    actorEnduserId: "",
    actionName: "trace.recorded",
    targetName: "openai/gpt-5-mini",
    anomalyAlertId: "",
    rawOcsfJson: JSON.stringify({ metadata: { extension: { tokens_input: 10 } } }),
  };
}

/** One traces query the export sends. */
export type TraceQuery = Parameters<TraceApi["listTraceSummaries"]>[0]["query"];

export function summary(traceId: string): TraceSummaryData {
  const at = Date.parse("2026-11-10T10:00:00Z");
  return {
    traceId,
    spanCount: 1,
    totalDurationMs: 1,
    computedIOSchemaVersion: "1",
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: ["openai/gpt-5-mini"],
    totalCost: 0.01,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: 10,
    totalCompletionTokenCount: 4,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    rootSpanType: null,
    containsAi: true,
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    selectedPromptStartTimeMs: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    lastUsedPromptStartTimeMs: null,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    attributes: {},
    traceName: "answer",
    occurredAt: at,
    createdAt: at,
    updatedAt: at,
    LastEventOccurredAt: at,
  };
}

export function auditEntry(id: string, at: string): AuditLogExportEntry {
  return {
    id,
    createdAt: new Date(at),
    userId: "user-1",
    actorUserId: null,
    organizationId: ORG,
    projectId: null,
    action: "organization.member.update",
    error: null,
    ipAddress: null,
    userAgent: null,
    targetKind: "member",
    targetId: "user-2",
  };
}

export async function buildApi({
  grants = ["complianceExport:view", "governance:manage"],
  planType = "ENTERPRISE",
  traces = {},
  traceQueries = [],
  updatedThrough,
  audit = [],
}: {
  grants?: string[];
  planType?: string;
  traces?: Record<string, TraceSummaryData[]>;
  /** Every traces query the export sends, in order. */
  traceQueries?: TraceQuery[];
  /** The bound every traces read reports as covered, as a scroll pinned before `until` does. */
  updatedThrough?: number;
  audit?: AuditLogExportEntry[];
} = {}) {
  const repositories = MemoryGovernanceRepositories.create();
  const app = await GovernanceModule.create({
    config: void 0,
    repositories,
    dependencies: {
      webhooks: createApiFixture<WebhookApi>({ getAll: async () => [] }),
      notifications: createApiFixture<NotificationService>(),
      agents: createApiFixture<AgentApi>(),
      projects: createApiFixture<ProjectApi>({
        getOrganizationId: async () => ORG,
        findInternal: async () => INTERNAL,
        ensureInternal: async () => INTERNAL,
        findLiveNonGovernanceIdsByOrganization: async () => PROJECTS,
      }),
      auth: createApiFixture<AuthApi>(),
      entitlements: createApiFixture<EntitlementApi>({
        getActivePlan: async () =>
          ({ type: planType }) as Awaited<ReturnType<EntitlementApi["getActivePlan"]>>,
      }),
      organizations: createApiFixture<OrganizationApi>(),
      permissions: createApiFixture<AuthzApi>(),
      scim: createApiFixture<ScimApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      traces: createApiFixture<TraceApi>({
        listTraceSummaries: async ({ query }) => {
          traceQueries.push(query);
          return {
            summaries: traces[query.projectId] ?? [],
            ...(updatedThrough === undefined ? {} : { updatedThrough }),
          };
        },
      }),
      apiKeys: createApiFixture<ApiKeyApi>(),
      gateway: createApiFixture<GatewayApi>(),
      enterpriseGateway: createApiFixture<EnterpriseGatewayApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
      users: createApiFixture<UserApi>(),
      auditLog: createApiFixture<AuditLogApi>({
        findForOrganization: async ({ afterMs, afterId, limit, untilMs }) =>
          audit
            .filter((entry) => untilMs === undefined || entry.createdAt.getTime() < untilMs)
            .filter(
              (entry) =>
                entry.createdAt.getTime() > afterMs ||
                (entry.createdAt.getTime() === afterMs && entry.id > afterId),
            )
            .slice(0, limit),
      }),
      logs: createApiFixture<LogApi>(),
      metrics: createApiFixture<MetricApi>(),
      retention: createApiFixture<DataRetentionApi>(),
    },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });

  const audits: unknown[] = [];
  const runtime = createRestRuntime({
    audit: {
      record: (row: unknown) => {
        audits.push(row);
      },
    },
    authorization: restTestAuthorization(),
    entitlements: { holds: async () => planType === "ENTERPRISE" },
    identity: {
      authenticate: ({ request, permission }) => {
        if (request.headers.get("Authorization") !== `Bearer ${KEY}`) {
          throw new TestCredentialError();
        }
        if (!grants.includes(permission)) throw new TestKeyPermissionError();
        return { actor: null, scope: { tier: "organization", id: ORG } as const };
      },
    },
  });
  const hono = runtime.mount(ocsfSiemRest.router(), {
    app: () => app,
    credential: "organization",
    onError: canonicalErrorResponse,
  });

  const get = (path: string) => hono.request(path, { headers: { Authorization: `Bearer ${KEY}` } });
  const post = (path: string, body: unknown) =>
    hono.request(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const seed = (rows: GovernanceOcsfEvent[]) => repositories.ocsfEvents.insertEvents(rows);

  const seatReports = () =>
    repositories.ocsfEvents.findLatestSeatReports({ tenantId: TENANT, actionName: "seat_report" });

  return { get, post, seed, audits, seatReports, hono, repositories };
}

export type Page = {
  ocsf_version: string;
  data: { metadata: { uid: string; version?: string }; [key: string]: unknown }[];
  next_cursor: string;
  has_more: boolean;
};

export const uids = (page: Page) => page.data.map((event) => event.metadata.uid);

export function okta(uid: string) {
  return {
    class_uid: 3002,
    activity_id: 1,
    severity_id: 1,
    time: Date.parse("2026-11-10T09:00:00Z"),
    metadata: { uid, version: "1.4.0", product: { name: "Okta" } },
    user: { name: "jane" },
  };
}
