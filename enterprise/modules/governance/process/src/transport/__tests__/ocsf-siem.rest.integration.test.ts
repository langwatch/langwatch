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
import { describe, expect, it } from "vitest";

import { GovernanceModule } from "../../app/governance.app.ts";
import type { GovernanceOcsfEvent } from "../../repositories/governance.repositories.ts";
import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { ocsfSiemRest } from "../ocsf-siem.rest.ts";

const ORG = "org-1";
const KEY = "org-key";
const TENANT = "governance-project";
const PROJECTS = ["project-a", "project-b"];

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

const INTERNAL: InternalProject = {
  id: TENANT,
  name: "Governance",
  slug: "governance",
  teamId: "team-1",
  kind: "internal_governance",
  archivedAtMs: null,
  traceSharingEnabled: false,
};

function governanceEvent(id: string, at: string, sourceType = "otel_generic"): GovernanceOcsfEvent {
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

function summary(traceId: string): TraceSummaryData {
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

function auditEntry(id: string, at: string): AuditLogExportEntry {
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

async function buildApi({
  grants = ["complianceExport:view", "governance:manage"],
  planType = "ENTERPRISE",
  traces = {},
  audit = [],
}: {
  grants?: string[];
  planType?: string;
  traces?: Record<string, TraceSummaryData[]>;
  audit?: AuditLogExportEntry[];
} = {}) {
  const repositories = MemoryGovernanceRepositories.create();
  const app = await GovernanceModule.create({
    config: void 0,
    repositories,
    dependencies: {
      webhooks: createApiFixture<WebhookApi>({ getAll: async () => [] }),
      agents: createApiFixture<AgentApi>(),
      projects: createApiFixture<ProjectApi>({
        getOrganizationId: async () => ORG,
        findInternal: async () => INTERNAL,
        ensureInternal: async () => INTERNAL,
        findLiveNonGovernanceIdsByOrganization: async () => PROJECTS,
      }),
      auth: createApiFixture<AuthApi>(),
      entitlements: createApiFixture<EntitlementApi>(),
      organizations: createApiFixture<OrganizationApi>(),
      permissions: createApiFixture<AuthzApi>(),
      scim: createApiFixture<ScimApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      traces: createApiFixture<TraceApi>({
        listTraceSummaries: async ({ query }) => ({ summaries: traces[query.projectId] ?? [] }),
      }),
      apiKeys: createApiFixture<ApiKeyApi>(),
      gateway: createApiFixture<GatewayApi>(),
      enterpriseGateway: createApiFixture<EnterpriseGatewayApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
      users: createApiFixture<UserApi>(),
      auditLog: createApiFixture<AuditLogApi>({
        findForOrganization: async ({ afterMs, afterId, limit }) =>
          audit
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

  const runtime = createRestRuntime({
    audit: { record: () => {} },
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

  return { get, post, seed };
}

type Page = {
  ocsf_version: string;
  data: { metadata: { uid: string; version?: string }; [key: string]: unknown }[];
  next_cursor: string;
  has_more: boolean;
};

const uids = (page: Page) => page.data.map((event) => event.metadata.uid);

function okta(uid: string) {
  return {
    class_uid: 3002,
    activity_id: 1,
    severity_id: 1,
    time: Date.parse("2026-11-10T09:00:00Z"),
    metadata: { uid, version: "1.4.0", product: { name: "Okta" } },
    user: { name: "jane" },
  };
}

describe("the OCSF SIEM REST family", () => {
  describe("given three governance events", () => {
    /** @scenario A key holding complianceExport:view pages the governance events with a cursor */
    it("pages them with a cursor and has_more", async () => {
      const { get, seed } = await buildApi();
      await seed([
        governanceEvent("e-1", "2026-11-10T10:00:00Z"),
        governanceEvent("e-2", "2026-11-10T11:00:00Z"),
        governanceEvent("e-3", "2026-11-10T12:00:00Z"),
      ]);

      const first = await get("/api/governance/ocsf/events?limit=2");
      const firstBody = (await first.json()) as Page;
      const second = (await (
        await get(`/api/governance/ocsf/events?limit=2&cursor=${firstBody.next_cursor}`)
      ).json()) as Page;

      expect(first.status).toBe(200);
      expect(firstBody.ocsf_version).toBe("1.9.0");
      expect(uids(firstBody)).toEqual(["e-1", "e-2"]);
      expect(firstBody.has_more).toBe(true);
      expect(firstBody.data[0]).toMatchObject({
        class_uid: 6003,
        ai_model: { name: "gpt-5-mini", ai_provider: "openai" },
      });
      expect(uids(second)).toEqual(["e-3"]);
      expect(second.has_more).toBe(false);
      expect(second.next_cursor).toBeTruthy();
    });
  });

  describe("given events from two source types on two days", () => {
    /** @scenario The export filters governance events by time range and source type */
    it("returns only the source type's events since the second day", async () => {
      const { get, seed } = await buildApi();
      await seed([
        governanceEvent("old-a", "2026-11-09T10:00:00Z", "otel_generic"),
        governanceEvent("new-a", "2026-11-10T10:00:00Z", "otel_generic"),
        governanceEvent("new-b", "2026-11-10T11:00:00Z", "claude_compliance"),
      ]);

      const page = (await (
        await get(
          "/api/governance/ocsf/events?source_type=otel_generic&since=2026-11-10T00:00:00Z&until=2026-11-11T00:00:00Z",
        )
      ).json()) as Page;

      expect(uids(page)).toEqual(["new-a"]);
    });
  });

  describe("given a key holding only governance:view", () => {
    /** @scenario A key without complianceExport:view is refused */
    it("answers 403", async () => {
      const { get } = await buildApi({ grants: ["governance:view"] });

      const response = await get("/api/governance/ocsf/events");

      expect(response.status).toBe(403);
    });
  });

  describe("given an organisation on the Growth plan", () => {
    /** @scenario An organisation off the Enterprise plan is refused the export */
    it("answers 402 enterprise_plan_required on every route", async () => {
      const { get, post } = await buildApi({ planType: "GROWTH" });

      const answers = await Promise.all([
        get("/api/governance/ocsf/events"),
        get("/api/governance/ocsf/traces"),
        get("/api/governance/ocsf/audit"),
        post("/api/governance/ocsf/ingest", { source: "okta", events: [okta("o-1")] }),
      ]);

      for (const answer of answers) {
        expect(answer.status).toBe(402);
        expect(await answer.json()).toMatchObject({ code: "enterprise_plan_required" });
      }
    });
  });

  describe("given a cursor the export did not issue", () => {
    /** @scenario A cursor the export did not issue is a validation error */
    it("answers 422 validation_error", async () => {
      const { get } = await buildApi();

      const response = await get("/api/governance/ocsf/events?cursor=not-a-cursor");
      const body = (await response.json()) as { code: string };

      expect(response.status).toBe(422);
      expect(body.code).toBe("validation_error");
    });
  });

  describe("given each project holds one trace", () => {
    /** @scenario The project traces stream walks every project and resumes from its cursor */
    it("returns both traces and ends with a cursor for the next window", async () => {
      const { get } = await buildApi({
        traces: { "project-a": [summary("t-a")], "project-b": [summary("t-b")] },
      });

      const seen: string[] = [];
      let cursor: string | undefined;
      let page: Page;
      do {
        const query = cursor
          ? `?until=2026-11-11T00:00:00Z&cursor=${cursor}`
          : "?until=2026-11-11T00:00:00Z";
        page = (await (await get(`/api/governance/ocsf/traces${query}`)).json()) as Page;
        seen.push(...uids(page));
        cursor = page.next_cursor;
      } while (page.has_more);

      expect(seen).toEqual(["trace:project-a:t-a", "trace:project-b:t-b"]);
      const resume = JSON.parse(Buffer.from(page.next_cursor, "base64url").toString("utf8")) as {
        f: number;
        p: string | null;
      };
      expect(resume).toMatchObject({ p: null, f: Date.parse("2026-11-11T00:00:00Z") });
    });

    /** @scenario A project outside the organisation is refused on the project traces stream */
    it("refuses a project of another organisation with 422", async () => {
      const { get } = await buildApi();

      const response = await get("/api/governance/ocsf/traces?project_id=project-elsewhere");
      const body = (await response.json()) as { code: string };

      expect(response.status).toBe(422);
      expect(body.code).toBe("validation_error");
    });
  });

  describe("given three audit entries", () => {
    /** @scenario The audit stream lists the organisation's audit entries after a cursor */
    it("returns them in order across two pages", async () => {
      const { get } = await buildApi({
        audit: [
          auditEntry("a-1", "2026-11-10T10:00:00Z"),
          auditEntry("a-2", "2026-11-10T11:00:00Z"),
          auditEntry("a-3", "2026-11-10T12:00:00Z"),
        ],
      });

      const first = (await (await get("/api/governance/ocsf/audit?limit=2")).json()) as Page;
      const second = (await (
        await get(`/api/governance/ocsf/audit?limit=2&cursor=${first.next_cursor}`)
      ).json()) as Page;

      expect(uids(first)).toEqual(["audit:a-1", "audit:a-2"]);
      expect(first.has_more).toBe(true);
      expect(uids(second)).toEqual(["audit:a-3"]);
      expect(second.has_more).toBe(false);
      expect(first.data[0]).toMatchObject({ activity_id: 3, actor: { user: { uid: "user-1" } } });
    });
  });

  describe("given OCSF events from another source", () => {
    /** @scenario Ingested OCSF events are stored and read back in the export */
    it("stores them and exports them as sent", async () => {
      const { get, post } = await buildApi();

      const response = await post("/api/governance/ocsf/ingest", {
        source: "okta",
        events: [okta("o-1"), okta("o-2")],
      });
      const page = (await (
        await get("/api/governance/ocsf/events?source_type=ocsf_push")
      ).json()) as Page;

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ accepted: 2 });
      expect(page.data).toEqual([okta("o-1"), okta("o-2")]);
    });

    /** @scenario An OCSF event sent twice is stored once */
    it("stores an event sent twice once", async () => {
      const { get, post } = await buildApi();

      await post("/api/governance/ocsf/ingest", { source: "okta", events: [okta("o-1")] });
      await post("/api/governance/ocsf/ingest", { source: "okta", events: [okta("o-1")] });
      const page = (await (
        await get("/api/governance/ocsf/events?source_type=ocsf_push")
      ).json()) as Page;

      expect(uids(page)).toEqual(["o-1"]);
    });

    /** @scenario An OCSF event without metadata.uid is refused */
    it("refuses an event with no metadata.uid with 422 naming the field", async () => {
      const { post } = await buildApi();
      const event = { ...okta("o-1"), metadata: { version: "1.4.0" } };

      const response = await post("/api/governance/ocsf/ingest", {
        source: "okta",
        events: [event],
      });
      const body = (await response.json()) as { code: string };

      expect(response.status).toBe(422);
      expect(body.code).toBe("validation_error");
      expect(JSON.stringify(body)).toContain("metadata");
      expect(JSON.stringify(body)).toContain("uid");
    });

    /** @scenario A key without governance:manage cannot push events in */
    it("answers 403 for a key holding only complianceExport:view", async () => {
      const { post } = await buildApi({ grants: ["complianceExport:view"] });

      const response = await post("/api/governance/ocsf/ingest", {
        source: "okta",
        events: [okta("o-1")],
      });

      expect(response.status).toBe(403);
    });
  });
});
