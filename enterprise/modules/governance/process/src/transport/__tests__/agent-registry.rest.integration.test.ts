/**
 * The agent registry door over the real governance application and memory repositories:
 * access, paging, filters and the change feed. Spec: specs/agent-registry.feature
 */
import type { Agent, AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
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
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { Temporal } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import type { WebhookApi } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import { GovernanceModule } from "../../app/governance.app.ts";
import type { RegistryDraft } from "../../features/registry/rules/registry-entry.rules.ts";
import { planRegistryChanges } from "../../features/registry/rules/registry-reconcile.rules.ts";
import { MemoryGovernanceRepositories } from "../../repositories/memory/memory.governance.repositories.ts";
import { agentRegistryRest } from "../agent-registry.rest.ts";

const ORG = "org-1";
const KEY = "org-key";

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

const AGENT: Agent = {
  id: "agent-1",
  projectId: "project-1",
  name: "Field agent",
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: new Date("2026-11-01T00:00:00Z"),
  updatedAt: new Date("2026-11-01T00:00:00Z"),
  type: "connected",
  config: { parameters: [], sdk: { name: "langwatch", version: "1.0.0", language: "python" } },
};

async function buildApi({ grants = ["governance:view"] }: { grants?: string[] } = {}) {
  const repositories = MemoryGovernanceRepositories.create();
  const app = await GovernanceModule.create({
    config: void 0,
    repositories,
    dependencies: {
      webhooks: createApiFixture<WebhookApi>(),
      agents: createApiFixture<AgentApi>({
        list: async () => ({
          data: [AGENT],
          pagination: { page: 1, limit: 200, total: 1, totalPages: 1 },
        }),
        platformUrl: () => "https://app.langwatch.test/agents",
      }),
      projects: createApiFixture<ProjectApi>({
        getOrganizationId: async () => ORG,
        findLiveNonGovernanceIdsByOrganization: async () => ["project-1"],
        listNamesByIds: async () => [],
      }),
      auth: createApiFixture<AuthApi>(),
      entitlements: createApiFixture<EntitlementApi>(),
      organizations: createApiFixture<OrganizationApi>({
        findMembersWithDepartments: async () => [],
      }),
      permissions: createApiFixture<AuthzApi>(),
      scim: createApiFixture<ScimApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
      traces: createApiFixture<TraceApi>({ findAgentsSeen: async () => [] }),
      apiKeys: createApiFixture<ApiKeyApi>(),
      gateway: createApiFixture<GatewayApi>(),
      enterpriseGateway: createApiFixture<EnterpriseGatewayApi>(),
      modelProviders: createApiFixture<ModelProviderApi>(),
      users: createApiFixture<UserApi>(),
      auditLog: createApiFixture<AuditLogApi>(),
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
  const hono = runtime.mount(agentRegistryRest.router(), {
    app: () => app,
    credential: "organization",
    onError: canonicalErrorResponse,
  });

  /** Seeds entries as a reconcile at `at` would write them. */
  const seed = (names: string[], at: string) =>
    repositories.agentRegistry.applyChanges({
      organizationId: ORG,
      plan: (stored) =>
        planRegistryChanges({
          stored,
          drafts: [
            ...stored.map((row) => ({ ...draft(row.entry.name), sourceKey: row.sourceKey })),
            ...names.map(draft),
          ],
          now: Temporal.Instant.from(at),
          newId: (() => {
            let next = 0;
            return () => `${names[0] ?? "x"}-${at}-${++next}`;
          })(),
        }),
    });

  const get = (path: string) => hono.request(path, { headers: { Authorization: `Bearer ${KEY}` } });

  return { app, repositories, seed, get };
}

describe("the agent registry REST family", () => {
  describe("given three entries", () => {
    /** @scenario The registry lists the organisation's entries a page at a time */
    it("pages them with a cursor", async () => {
      const { seed, get } = await buildApi();
      await seed(["alpha", "beta", "gamma"], "2026-11-10T00:00:00Z");

      const first = await get("/api/governance/registry/agents?limit=2");
      const firstBody = (await first.json()) as { data: unknown[]; next_cursor: string | null };
      expect(first.status).toBe(200);
      expect(firstBody.data).toHaveLength(2);
      expect(firstBody.next_cursor).not.toBeNull();

      const second = await get(
        `/api/governance/registry/agents?limit=2&cursor=${firstBody.next_cursor}`,
      );
      const secondBody = (await second.json()) as {
        data: { name: string }[];
        next_cursor: string | null;
      };
      expect(secondBody.data.map((entry) => entry.name)).toEqual(["gamma"]);
      expect(secondBody.next_cursor).toBeNull();
    });
  });

  describe("given entries updated on different days", () => {
    /** @scenario The registry filters entries updated since an instant */
    it("returns only those changed since the instant", async () => {
      const { seed, get } = await buildApi();
      await seed(["yesterday"], "2026-11-12T10:00:00Z");
      await seed(["today"], "2026-11-13T10:00:00Z");

      const response = await get(
        "/api/governance/registry/agents?updated_since=2026-11-13T06:00:00Z",
      );
      const body = (await response.json()) as { data: { name: string }[] };

      expect(body.data.map((entry) => entry.name)).toEqual(["today"]);
    });
  });

  describe("given an id the organisation does not hold", () => {
    /** @scenario An unknown registry id is a 404 */
    it("answers 404 agent_registry_entry_not_found", async () => {
      const { get } = await buildApi();

      const response = await get("/api/governance/registry/agents/unknown");
      const body = (await response.json()) as { code: string };

      expect(response.status).toBe(404);
      expect(body.code).toBe("agent_registry_entry_not_found");
    });
  });

  describe("given three appended events", () => {
    /** @scenario The event feed is read after a cursor in order */
    it("returns the events after the cursor in order", async () => {
      const { seed, get } = await buildApi();
      await seed(["one"], "2026-11-10T00:00:00Z");
      await seed(["two"], "2026-11-11T00:00:00Z");
      await seed(["three"], "2026-11-12T00:00:00Z");

      const all = (await (await get("/api/governance/registry/events")).json()) as {
        data: { sequence: string; agent: { name: string } }[];
      };
      const after = (await (
        await get(`/api/governance/registry/events?cursor=${all.data[0]?.sequence}`)
      ).json()) as { data: { agent: { name: string } }[] };

      expect(all.data).toHaveLength(3);
      expect(after.data.map((event) => event.agent.name)).toEqual(["two", "three"]);
    });
  });

  describe("given a key without governance:view", () => {
    /** @scenario A key without governance:view is refused */
    it("answers 403", async () => {
      const { get } = await buildApi({ grants: [] });

      const response = await get("/api/governance/registry/agents");

      expect(response.status).toBe(403);
    });
  });

  describe("given the agent module recorded a change in a project", () => {
    it("reconciles the project's organisation into the registry", async () => {
      const { app, repositories } = await buildApi();

      await app.reconcileAgentRegistryForProject({ projectId: "project-1" });

      const entries = await repositories.agentRegistry.findEntries({
        organizationId: ORG,
        limit: 100,
      });
      expect(entries.map((entry) => entry.name)).toEqual(["Field agent"]);
    });
  });
});
