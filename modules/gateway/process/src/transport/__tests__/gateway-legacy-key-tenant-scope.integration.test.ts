import { bindRestMiddleware, canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { GatewayRequestCredential } from "@langwatch/gateway-contract";
import { ResourceScope } from "@langwatch/process";
import type { Encryption } from "@langwatch/process-stores";
import type { ProjectApi, ProjectWithTeam } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
/**
 * @vitest-environment node
 * @see specs/ai-gateway/public-rest-api.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it, vi } from "vitest";

import { GatewayModule } from "../../app/gateway.app.ts";
import {
  gatewayKeyCaller,
  gatewayPlatformRest,
  gatewayRestCredential,
} from "../gateway-platform.rest.ts";

const ORG_A = "organization_a";
const ORG_B = "organization_b";
const PROJECT_A = "project_a";
const SIBLING_PROJECT_A = "project_a_sibling";
const PROJECT_B = "project_b";
const TEAM_A = "team_a";
const SIBLING_TEAM_A = "team_a_sibling";
const TEAM_B = "team_b";
const STOPPED_AT_INSERT = "the double stops at the first write";

const teams = [
  { id: TEAM_A, organizationId: ORG_A },
  { id: SIBLING_TEAM_A, organizationId: ORG_A },
  { id: TEAM_B, organizationId: ORG_B },
];
const projectTeams = new Map([
  [PROJECT_A, TEAM_A],
  [SIBLING_PROJECT_A, SIBLING_TEAM_A],
  [PROJECT_B, TEAM_B],
]);
const budgets = [
  {
    id: "budget_a_sibling",
    organizationId: ORG_A,
    scopeType: "PROJECT",
    scopeId: SIBLING_PROJECT_A,
  },
  { id: "budget_b", organizationId: ORG_B, scopeType: "ORGANIZATION", scopeId: ORG_B },
];
const storedCacheRule = {
  name: "no cache",
  description: null,
  priority: 100,
  enabled: true,
  matchers: { model: "gpt-5" },
  action: { mode: "disable" },
  modeEnum: "DISABLE",
  archivedAt: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  createdById: "user_a",
};
const cacheRules = [
  { ...storedCacheRule, id: "cache_rule_a", organizationId: ORG_A },
  { ...storedCacheRule, id: "cache_rule_b", organizationId: ORG_B },
];
const organizationUsers = [{ organizationId: ORG_B, userId: "user_b" }];
const virtualKeys = [{ id: "vk_b", organizationId: ORG_B, purpose: "USER" }];
const groups = [{ id: "group_b", organizationId: ORG_B }];
const modelProviders = [{ id: "provider_b", organizationId: ORG_B }];

function whereOf(args: unknown): Record<string, unknown> {
  const where: unknown =
    typeof args === "object" && args !== null ? Reflect.get(args, "where") : {};
  return typeof where === "object" && where !== null
    ? Object.fromEntries(Object.entries(where))
    : {};
}

/** The first row matching every plain equality in `where`; relation filters are skipped. */
function firstMatching<Row extends object>(rows: readonly Row[], args: unknown): Row | null {
  const where = whereOf(args);
  return (
    rows.find((row) =>
      Object.entries(where).every(
        ([key, value]) => typeof value === "object" || Reflect.get(row, key) === value,
      ),
    ) ?? null
  );
}

function projectWithTeam(projectId: string): ProjectWithTeam | null {
  const teamId = projectTeams.get(projectId);
  const team = teams.find((t) => t.id === teamId);
  if (!team) return null;
  const at = new Date("2026-09-01T00:00:00.000Z");
  const owned = { createdAt: at, updatedAt: at, archivedAt: null, isPersonal: false };
  return {
    ...owned,
    id: projectId,
    name: projectId,
    slug: projectId,
    apiKey: "",
    lwqlKey: "",
    teamId: team.id,
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
      id: team.id,
      name: team.id,
      slug: team.id,
      organizationId: team.organizationId,
      ownerUserId: null,
      departmentId: null,
    },
  };
}

const legacyProjectKey: GatewayRequestCredential = { kind: "legacyProjectKey" };

const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

const reversible: Encryption = {
  encrypt: (plaintext) => `sealed:${plaintext}`,
  decrypt: (ciphertext) => ciphertext.replace(/^sealed:/, ""),
};

/** Two organizations in one store; every write is recorded and stops there. */
async function mountAsLegacyProjectKey() {
  const writes: string[] = [];
  const stopAtWrite = (name: string) => async () => {
    writes.push(name);
    throw new Error(STOPPED_AT_INSERT);
  };
  const prisma = prismaDouble({
    team: { findFirst: async (args) => firstMatching(teams, args) },
    organizationUser: { findFirst: async (args) => firstMatching(organizationUsers, args) },
    virtualKey: {
      findFirst: async (args) => firstMatching(virtualKeys, args),
      findMany: async () => [],
    },
    group: { findFirst: async (args) => firstMatching(groups, args) },
    modelProvider: { findFirst: async (args) => firstMatching(modelProviders, args) },
    gatewayBudget: { findFirst: async (args) => firstMatching(budgets, args) },
    gatewayCacheRule: { findFirst: async (args) => firstMatching(cacheRules, args) },
    $transaction: stopAtWrite("transaction"),
  });
  const projects = createApiFixture<ProjectApi>({
    findOrganizationId: async (projectId) =>
      projectWithTeam(projectId)?.team.organizationId ?? undefined,
    findWithTeam: async (projectId) => projectWithTeam(projectId),
    listTraceDestinations: async () => [],
  });

  const app = await GatewayModule.create({
    dependencies: {
      webhooks: createApiFixture({}),
      entitlement: createApiFixture({}),
      authz: createApiFixture<AuthzApi>({}),
      projects,
      evaluators: createApiFixture({}),
      evaluations: createApiFixture({}),
      monitors: createApiFixture({}),
      organizations: createApiFixture({}),
      featureFlags: createApiFixture({}),
      modelProviders: createApiFixture({}),
      traces: createApiFixture({}),
      oneTimeReveals: createApiFixture({}),
      apiKeys: createApiFixture({}),
    },
    members: {
      prisma,
      clickhouse: createApiFixture<ClickHouseQueryClient>({}),
      encryption: reversible,
      redis: memoryRedisDouble(),
      publicBaseUrl: "https://app.acme.example",
    },
    config: {
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      baseUrl: void 0,
      publicUrl: void 0,
      isSaas: false,
      allowLoopbackVoiceProviders: false,
    },
    resources: new ResourceScope(),
    secrets: noSecrets,
  });
  const createBudget = vi.spyOn(app, "createBudget");
  const createCacheRule = vi.spyOn(app, "createCacheRule");

  const door = () => ({
    actor: { type: "api_key" as const, id: "legacy-project-key" },
    scope: { tier: "project" as const, id: PROJECT_A },
  });
  const keyDoor = () => ({
    actor: { type: "api_key" as const, id: "legacy-project-key" },
    scope: { tier: "organization" as const, id: ORG_A },
  });
  const runtime = createRestRuntime({
    identity: { authenticate: door, identify: door },
    doors: { api_key: { authenticate: keyDoor, identify: keyDoor } },
    idempotency: async ({ handler }) => {
      const response = await handler();
      return { isReplayed: false, status: response.status, response };
    },
  });
  const hono = runtime.mount(gatewayPlatformRest.router(), {
    app: () => app,
    onError: canonicalErrorResponse,
    facts: [
      bindRestMiddleware(gatewayRestCredential, () => legacyProjectKey),
      bindRestMiddleware(gatewayKeyCaller, () => ({
        kind: "project" as const,
        projectId: PROJECT_A,
      })),
    ],
  });

  const send = async (method: string, path: string, body?: object) => {
    const response = await hono.request(`/api/gateway/v1${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const answer: unknown = await response.json();
    return { status: response.status, answer };
  };

  return { send, writes, createBudget, createCacheRule };
}

function budgetAt(scope: object, extra: object = {}) {
  return { scope, name: "cap", window: "month", limit_usd: 5, ...extra };
}

const cacheRule = {
  name: "no cache",
  matchers: { model: "gpt-5" },
  action: { mode: "disable" },
};

describe("a legacy project key's organization-wide gateway writes", () => {
  describe("when it names another organization's resource as a budget's scope", () => {
    const foreignScopes = [
      [
        "organization",
        { kind: "organization", organization_id: ORG_B },
        400,
        "gateway_scope_org_mismatch",
      ],
      ["team", { kind: "team", team_id: TEAM_B }, 400, "gateway_scope_org_mismatch"],
      ["project", { kind: "project", project_id: PROJECT_B }, 400, "gateway_scope_org_mismatch"],
      [
        "virtual key",
        { kind: "virtual_key", virtual_key_id: "vk_b" },
        404,
        "virtual_key_not_found",
      ],
      [
        "principal",
        { kind: "principal", principal_user_id: "user_b" },
        400,
        "gateway_scope_org_mismatch",
      ],
      ["group", { kind: "group", group_id: "group_b" }, 400, "gateway_scope_org_mismatch"],
      [
        "attributed-user key anchor",
        { kind: "attributed_user", anchor_virtual_key_id: "vk_b" },
        400,
        "gateway_scope_org_mismatch",
      ],
      [
        "attributed-user project anchor",
        { kind: "attributed_user", anchor_project_id: PROJECT_B },
        400,
        "gateway_scope_org_mismatch",
      ],
    ] as const;

    /** @scenario "A legacy project key cannot aim a budget at another organization" */
    /** @scenario A TEAM budget cannot target another org's team */
    /** @scenario A GROUP budget cannot target another org's group */
    /** @scenario A PRINCIPAL budget must target a member of the org */
    it.each(foreignScopes)(
      "refuses the %s scope by code and writes nothing",
      async (_name, scope, status, code) => {
        const world = await mountAsLegacyProjectKey();

        const { status: answered, answer } = await world.send("POST", "/budgets", budgetAt(scope));

        expect(answered).toBe(status);
        expect(answer).toMatchObject({ code });
        expect(world.writes).toEqual([]);
      },
    );

    /** @scenario "A legacy project key cannot aim a budget at another organization" */
    it("refuses another organization's model provider by code and writes nothing", async () => {
      const world = await mountAsLegacyProjectKey();

      const { status, answer } = await world.send(
        "POST",
        "/budgets",
        budgetAt({ kind: "organization", organization_id: ORG_A }, { provider_key: "provider_b" }),
      );

      expect(status).toBe(400);
      expect(answer).toMatchObject({ code: "gateway_scope_org_mismatch" });
      expect(world.writes).toEqual([]);
    });
  });

  describe("when it addresses another organization's budget or cache rule by id", () => {
    const foreignRows = [
      ["updates a budget", "PATCH", "/budgets/budget_b", { name: "mine" }, "budget_not_found"],
      ["archives a budget", "DELETE", "/budgets/budget_b", undefined, "budget_not_found"],
      ["resets a budget", "POST", "/budgets/budget_b/reset", {}, "budget_not_found"],
      [
        "updates a cache rule",
        "PATCH",
        "/cache-rules/cache_rule_b",
        { priority: 1 },
        "gateway_cache_rule_not_found",
      ],
      [
        "archives a cache rule",
        "DELETE",
        "/cache-rules/cache_rule_b",
        undefined,
        "gateway_cache_rule_not_found",
      ],
    ] as const;

    /** @scenario "A legacy project key cannot change another organization's budget or cache rule" */
    it.each(foreignRows)(
      "answers 404 when it %s, and writes nothing",
      async (_name, method, path, body, code) => {
        const world = await mountAsLegacyProjectKey();

        const { status, answer } = await world.send(method, path, body);

        expect(status).toBe(404);
        expect(answer).toMatchObject({ code });
        expect(world.writes).toEqual([]);
      },
    );
  });

  describe("when it writes inside its own organization, as main allowed", () => {
    /** @scenario "A legacy project key's writes land in its own project's organization" */
    it("files a sibling team's budget under the key's organization", async () => {
      const world = await mountAsLegacyProjectKey();

      await world.send("POST", "/budgets", budgetAt({ kind: "team", team_id: SIBLING_TEAM_A }));

      expect(world.createBudget).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_A,
          scope: { kind: "TEAM", teamId: SIBLING_TEAM_A },
        }),
      );
      expect(world.writes).toEqual(["transaction"]);
    });

    /** @scenario "A legacy project key's writes land in its own project's organization" */
    it("files a cache rule under the key's organization whatever the body names", async () => {
      const world = await mountAsLegacyProjectKey();

      await world.send("POST", "/cache-rules", { ...cacheRule, organization_id: ORG_B });

      expect(world.createCacheRule).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_A }),
      );
      expect(world.writes).toEqual(["transaction"]);
    });

    /** @scenario "A legacy project key's writes land in its own project's organization" */
    it("archives a sibling project's budget and a cache rule of its own organization", async () => {
      const world = await mountAsLegacyProjectKey();

      await world.send("DELETE", "/budgets/budget_a_sibling");
      await world.send("DELETE", "/cache-rules/cache_rule_a");

      expect(world.writes).toEqual(["transaction", "transaction"]);
    });
  });
});
