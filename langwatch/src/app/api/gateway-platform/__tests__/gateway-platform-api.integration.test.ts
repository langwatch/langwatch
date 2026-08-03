/**
 * @vitest-environment node
 *
 * The public gateway REST surface (/api/gateway/v1/*), end to end against
 * real Postgres + real ClickHouse, through the same Hono app production
 * mounts.
 *
 * This app shipped for months with zero tests, which is how its create
 * schema kept demanding an entity deleted in iter 110 (#6260) and its
 * budget service lost the ClickHouse spend wiring (#6248). These tests pin
 * the two properties that make that drift impossible to reintroduce
 * silently:
 *
 *   1. REST behaves exactly like tRPC because it runs the SAME service
 *      layer: the refusals asserted here (trace_project_required,
 *      permission_denied per scope, routing_policy_required,
 *      group-budget guards) are implemented ONLY in the shared services
 *      and asserts — remove the shared routing and these fail.
 *   2. Spend figures over REST come from the live ClickHouse ledgers, not
 *      the stale PG column: the ledger-backed assertions fail if the
 *      repository wiring is dropped again.
 *
 * Spec: specs/ai-gateway/public-rest-api.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { generate } from "@langwatch/ksuid";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiKeyService } from "~/server/api-key/api-key.service";
import { prisma } from "~/server/db";
import {
  getTestClickHouseClient,
  startTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { KSUID_RESOURCES } from "~/utils/constants";
import { app } from "../[[...route]]/app";

const suffix = nanoid(8);
const ORG_ID = `org-gwrest-${suffix}`;
const TEAM_ID = `team-gwrest-${suffix}`;
const PROJECT_ID = `proj-gwrest-${suffix}`;
const SIBLING_TEAM_ID = `team-gwrest-sib-${suffix}`;
const SIBLING_PROJECT_ID = `proj-gwrest-sib-${suffix}`;
const GOV_PROJECT_ID = `proj-gwrest-gov-${suffix}`;
const GROUP_ID = `grp-gwrest-${suffix}`;
const MP_OPENAI_ID = `mp-gwrest-openai-${suffix}`;

const ADMIN_USER_ID = `usr-gwrest-admin-${suffix}`;
const MEMBER_USER_ID = `usr-gwrest-member-${suffix}`;
const VIEWER_USER_ID = `usr-gwrest-viewer-${suffix}`;
const OUTSIDE_USER_ID = `usr-gwrest-outside-${suffix}`;

// An org with NO governance project, exclusively for the
// trace_project_required refusal — its absence must be a property of the
// org, not of test ordering.
const NOGOV_ORG_ID = `org-gwrest-nogov-${suffix}`;
const NOGOV_TEAM_ID = `team-gwrest-nogov-${suffix}`;
const NOGOV_PROJECT_ID = `proj-gwrest-nogov-${suffix}`;

// A foreign tenant whose resources must never be reachable from ORG_ID.
const FOREIGN_ORG_ID = `org-gwrest-foreign-${suffix}`;
const FOREIGN_TEAM_ID = `team-gwrest-foreign-${suffix}`;
const FOREIGN_PROJECT_ID = `proj-gwrest-foreign-${suffix}`;

const LEGACY_KEY = `sk-lw-${nanoid(48)}`;
const SIBLING_LEGACY_KEY = `sk-lw-${nanoid(48)}`;
const NOGOV_LEGACY_KEY = `sk-lw-${nanoid(48)}`;
const FOREIGN_LEGACY_KEY = `sk-lw-${nanoid(48)}`;

const ALL_ORG_IDS = [ORG_ID, NOGOV_ORG_ID, FOREIGN_ORG_ID];
const ALL_USER_IDS = [
  ADMIN_USER_ID,
  MEMBER_USER_ID,
  VIEWER_USER_ID,
  OUTSIDE_USER_ID,
];
const ALL_PROJECT_IDS = [
  PROJECT_ID,
  SIBLING_PROJECT_ID,
  GOV_PROJECT_ID,
  NOGOV_PROJECT_ID,
  FOREIGN_PROJECT_ID,
];

let adminToken = "";
let memberToken = "";
let viewerToken = "";
let nogovAdminToken = "";

function ch(): ClickHouseClient {
  const client = getTestClickHouseClient();
  if (!client) throw new Error("test ClickHouse client not available");
  return client;
}

const jsonHeaders = { "Content-Type": "application/json" };

function legacyAuth(key: string = LEGACY_KEY): Record<string, string> {
  return { "X-Auth-Token": key, ...jsonHeaders };
}

function apiKeyAuth(
  token: string,
  projectId: string = PROJECT_ID,
): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "X-Project-Id": projectId,
    ...jsonHeaders,
  };
}

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function patch(
  path: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<Response> {
  return app.request(path, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

async function createVk(
  body: Record<string, unknown>,
  headers: Record<string, string> = legacyAuth(),
): Promise<{ status: number; body: any }> {
  const res = await post("/api/gateway/v1/virtual-keys", body, headers);
  return { status: res.status, body: await res.json() };
}

async function insertGatewayTrace(args: {
  tenantId: string;
  traceId: string;
  virtualKeyId: string;
  occurredAt: Date;
  totalCost: number;
}): Promise<void> {
  await ch().insert({
    table: "trace_summaries",
    values: [
      {
        ProjectionId: `projn-${nanoid()}`,
        TenantId: args.tenantId,
        TraceId: args.traceId,
        Version: "v1",
        Attributes: { "langwatch.virtual_key_id": args.virtualKeyId },
        OccurredAt: args.occurredAt,
        CreatedAt: args.occurredAt,
        UpdatedAt: args.occurredAt,
        ComputedIOSchemaVersion: "",
        ComputedInput: null,
        ComputedOutput: null,
        TimeToFirstTokenMs: null,
        TimeToLastTokenMs: null,
        TotalDurationMs: 250,
        TokensPerSecond: null,
        SpanCount: 1,
        ContainsErrorStatus: 0,
        ContainsOKStatus: 1,
        ErrorMessage: null,
        Models: ["gpt-5-mini"],
        TotalCost: args.totalCost,
        NonBilledCost: 0,
        TokensEstimated: false,
        TotalPromptTokenCount: 100,
        TotalCompletionTokenCount: 50,
        OutputFromRootSpan: 0,
        OutputSpanEndTimeMs: 0,
        BlockedByGuardrail: 0,
        TopicId: null,
        SubTopicId: null,
        HasAnnotation: null,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

async function seedTenant(args: {
  orgId: string;
  teamId: string;
  projectId: string;
  legacyKey: string;
  orgSlug: string;
}): Promise<void> {
  await prisma.organization.create({
    data: {
      id: args.orgId,
      name: `GW REST ${args.orgSlug}`,
      slug: args.orgSlug,
    },
  });
  await prisma.team.create({
    data: {
      id: args.teamId,
      name: `GW REST team ${args.orgSlug}`,
      slug: `${args.orgSlug}-team`,
      organizationId: args.orgId,
    },
  });
  await prisma.project.create({
    data: {
      id: args.projectId,
      name: `GW REST project ${args.orgSlug}`,
      slug: `${args.orgSlug}-proj`,
      language: "typescript",
      framework: "other",
      apiKey: args.legacyKey,
      teamId: args.teamId,
    },
  });
}

async function seedUserWithRole(args: {
  userId: string;
  orgId: string;
  teamId: string | null;
  orgRole: OrganizationUserRole;
  teamRole: TeamUserRole | null;
  bindingScope: { type: RoleBindingScopeType; id: string };
  bindingRole: TeamUserRole;
}): Promise<string> {
  await prisma.user.create({
    data: {
      id: args.userId,
      name: args.userId,
      email: `${args.userId}@example.com`,
    },
  });
  await prisma.organizationUser.create({
    data: {
      userId: args.userId,
      organizationId: args.orgId,
      role: args.orgRole,
    },
  });
  if (args.teamId && args.teamRole) {
    await prisma.teamUser.create({
      data: { userId: args.userId, teamId: args.teamId, role: args.teamRole },
    });
  }
  await prisma.roleBinding.create({
    data: {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId: args.orgId,
      userId: args.userId,
      role: args.bindingRole,
      scopeType: args.bindingScope.type,
      scopeId: args.bindingScope.id,
    },
  });
  const created = await ApiKeyService.create(prisma).create({
    name: `gwrest-${args.userId}`,
    userId: args.userId,
    createdByUserId: args.userId,
    organizationId: args.orgId,
    permissionMode: "all",
    bindings: [
      {
        role: args.bindingRole,
        scopeType: args.bindingScope.type,
        scopeId: args.bindingScope.id,
      },
    ],
  });
  return created.token;
}

describe("gateway platform REST API (real PG + real CH)", () => {
  beforeAll(async () => {
    await startTestContainers();

    await seedTenant({
      orgId: ORG_ID,
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
      legacyKey: LEGACY_KEY,
      orgSlug: `gwrest-${suffix}`,
    });
    // Governance project: where org- and team-scoped keys land traces.
    await prisma.project.create({
      data: {
        id: GOV_PROJECT_ID,
        name: `GW REST governance ${suffix}`,
        slug: `gwrest-gov-${suffix}`,
        language: "typescript",
        framework: "other",
        apiKey: `sk-lw-${nanoid(48)}`,
        teamId: TEAM_ID,
        kind: "internal_governance",
      },
    });
    // Sibling team in the same org — its keys must be invisible to the
    // caller's project credential.
    await prisma.team.create({
      data: {
        id: SIBLING_TEAM_ID,
        name: `GW REST sibling ${suffix}`,
        slug: `gwrest-sib-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: SIBLING_PROJECT_ID,
        name: `GW REST sibling project ${suffix}`,
        slug: `gwrest-sib-proj-${suffix}`,
        language: "typescript",
        framework: "other",
        apiKey: SIBLING_LEGACY_KEY,
        teamId: SIBLING_TEAM_ID,
      },
    });

    await seedTenant({
      orgId: NOGOV_ORG_ID,
      teamId: NOGOV_TEAM_ID,
      projectId: NOGOV_PROJECT_ID,
      legacyKey: NOGOV_LEGACY_KEY,
      orgSlug: `gwrest-nogov-${suffix}`,
    });
    await seedTenant({
      orgId: FOREIGN_ORG_ID,
      teamId: FOREIGN_TEAM_ID,
      projectId: FOREIGN_PROJECT_ID,
      legacyKey: FOREIGN_LEGACY_KEY,
      orgSlug: `gwrest-foreign-${suffix}`,
    });

    adminToken = await seedUserWithRole({
      userId: ADMIN_USER_ID,
      orgId: ORG_ID,
      teamId: TEAM_ID,
      orgRole: OrganizationUserRole.ADMIN,
      teamRole: TeamUserRole.ADMIN,
      bindingScope: { type: RoleBindingScopeType.ORGANIZATION, id: ORG_ID },
      bindingRole: TeamUserRole.ADMIN,
    });
    memberToken = await seedUserWithRole({
      userId: MEMBER_USER_ID,
      orgId: ORG_ID,
      teamId: TEAM_ID,
      orgRole: OrganizationUserRole.MEMBER,
      teamRole: TeamUserRole.MEMBER,
      bindingScope: { type: RoleBindingScopeType.PROJECT, id: PROJECT_ID },
      bindingRole: TeamUserRole.MEMBER,
    });
    viewerToken = await seedUserWithRole({
      userId: VIEWER_USER_ID,
      orgId: ORG_ID,
      teamId: TEAM_ID,
      orgRole: OrganizationUserRole.MEMBER,
      teamRole: TeamUserRole.VIEWER,
      bindingScope: { type: RoleBindingScopeType.PROJECT, id: PROJECT_ID },
      bindingRole: TeamUserRole.VIEWER,
    });
    nogovAdminToken = await seedUserWithRole({
      userId: OUTSIDE_USER_ID,
      orgId: NOGOV_ORG_ID,
      teamId: NOGOV_TEAM_ID,
      orgRole: OrganizationUserRole.ADMIN,
      teamRole: TeamUserRole.ADMIN,
      bindingScope: {
        type: RoleBindingScopeType.ORGANIZATION,
        id: NOGOV_ORG_ID,
      },
      bindingRole: TeamUserRole.ADMIN,
    });

    // A group with two members, for per-member GROUP budgets.
    await prisma.group.create({
      data: {
        id: GROUP_ID,
        name: `GW REST group ${suffix}`,
        slug: `gwrest-grp-${suffix}`,
        organizationId: ORG_ID,
        members: {
          create: [{ userId: ADMIN_USER_ID }, { userId: MEMBER_USER_ID }],
        },
      },
    });

    await prisma.modelProvider.create({
      data: {
        id: MP_OPENAI_ID,
        name: "openai",
        provider: "openai",
        enabled: true,
        organizationId: ORG_ID,
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
      },
    });
  });

  afterAll(async () => {
    // Every filter names module-level constants (or `in` lists built from
    // them), so a failed setup can never widen a delete (see the
    // undefined-collapse footgun: prisma drops undefined keys entirely).
    // Postgres first: `ch()` throws when the test client is missing —
    // exactly the broken-setup case — and must not abort the PG cleanup.
    await prisma.auditLog.deleteMany({
      where: { organizationId: { in: ALL_ORG_IDS } },
    });
    await prisma.gatewayChangeEvent.deleteMany({
      where: { organizationId: { in: ALL_ORG_IDS } },
    });
    await prisma.gatewayBudget.deleteMany({
      where: { organizationId: { in: ALL_ORG_IDS } },
    });
    await prisma.virtualKey.deleteMany({
      where: { organizationId: { in: ALL_ORG_IDS } },
    });
    for (const orgId of ALL_ORG_IDS) {
      // The multitenancy guard wants a scalar organizationId per call.
      await prisma.modelProvider.deleteMany({
        where: { organizationId: orgId },
      });
    }
    await prisma.group.deleteMany({
      where: { organizationId: { in: ALL_ORG_IDS } },
    });
    await prisma.roleBinding.deleteMany({
      where: { organizationId: { in: ALL_ORG_IDS } },
    });
    await prisma.apiKey.deleteMany({
      where: { organizationId: { in: ALL_ORG_IDS } },
    });
    await prisma.teamUser.deleteMany({
      where: { userId: { in: ALL_USER_IDS } },
    });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: ALL_ORG_IDS } },
    });
    await prisma.project.deleteMany({
      where: { id: { in: ALL_PROJECT_IDS } },
    });
    await prisma.team.deleteMany({
      where: { organizationId: { in: ALL_ORG_IDS } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ALL_USER_IDS } } });
    await prisma.organization.deleteMany({
      where: { id: { in: ALL_ORG_IDS } },
    });
    await ch().command({
      query: `DELETE FROM trace_summaries WHERE TenantId IN ('${PROJECT_ID}', '${GOV_PROJECT_ID}')`,
    });
    await ch().command({
      query: `DELETE FROM gateway_budget_ledger_events WHERE TenantId IN ('${PROJECT_ID}', '${GOV_PROJECT_ID}')`,
    });
  });

  // ── Auth ──────────────────────────────────────────────────────────────

  describe("authentication and permission ceiling", () => {
    /** @scenario Reject unauthenticated gateway REST calls */
    it("returns 401 without credentials", async () => {
      const res = await app.request("/api/gateway/v1/virtual-keys");
      expect(res.status).toBe(401);
    });

    /** @scenario Provider binding routes are gone since the ModelProvider fold */
    it("returns 410 for the folded provider-binding routes", async () => {
      const res = await app.request("/api/gateway/v1/providers", {
        headers: legacyAuth(),
      });
      expect(res.status).toBe(410);
      // A 410 without a forwarding address is a dead end for SDK authors.
      expect((await res.json()).message).toContain("model-providers");
    });

    /** @scenario A viewer-scoped API key can list but not create virtual keys */
    it("viewer API key: GET 200, POST 403 at the ceiling", async () => {
      const list = await app.request("/api/gateway/v1/virtual-keys", {
        headers: apiKeyAuth(viewerToken),
      });
      expect(list.status).toBe(200);

      const create = await createVk(
        { name: `viewer-denied-${suffix}` },
        apiKeyAuth(viewerToken),
      );
      expect(create.status).toBe(403);
    });
  });

  // ── Virtual keys: create ──────────────────────────────────────────────

  describe("virtual key create", () => {
    /** @scenario Create a virtual key with the SDK's current shape */
    it("accepts the SDK shape and defaults scope to the caller's project", async () => {
      const { status, body } = await createVk({ name: `sdk-min-${suffix}` });
      expect(status).toBe(201);
      expect(body.secret).toMatch(/^vk-lw-/);
      expect(body.virtual_key.name).toBe(`sdk-min-${suffix}`);
      expect(body.virtual_key.scopes).toEqual([
        { scope_type: "PROJECT", scope_id: PROJECT_ID },
      ]);
      expect(body.virtual_key.routing_mode).toBe("NONE");
      expect(body.virtual_key.purpose).toBe("user");
      expect(body.virtual_key.status).toBe("active");
      // The ghost of the deleted GatewayProviderCredential entity must be
      // gone from the wire in both directions.
      expect(body.virtual_key).not.toHaveProperty("provider_credential_ids");

      const get = await app.request(
        `/api/gateway/v1/virtual-keys/${body.virtual_key.id}`,
        { headers: legacyAuth() },
      );
      expect(get.status).toBe(200);
      const fetched = await get.json();
      expect(fetched.virtual_key.id).toBe(body.virtual_key.id);
      expect(fetched.virtual_key).not.toHaveProperty("secret");
    });

    /** @scenario Ghost provider_credential_ids no longer gates creation */
    it("ignores provider_credential_ids instead of demanding it", async () => {
      // The old schema required min(1) of an entity deleted in iter 110,
      // so our own SDK's requests 400'd. Unknown fields are now simply
      // stripped.
      const { status } = await createVk({
        name: `no-ghost-${suffix}`,
        provider_credential_ids: [],
      });
      expect(status).toBe(201);
    });

    /** @scenario Explicit project scopes are accepted with config */
    it("accepts explicit scopes, config, and routing_mode", async () => {
      const { status, body } = await createVk({
        name: `explicit-${suffix}`,
        scopes: [{ scope_type: "PROJECT", scope_id: PROJECT_ID }],
        routing_mode: "FALLBACK_ALL",
        config: { modelsAllowed: ["gpt-5-mini"] },
      });
      expect(status).toBe(201);
      expect(body.virtual_key.routing_mode).toBe("FALLBACK_ALL");
      expect(body.virtual_key.config.modelsAllowed).toEqual(["gpt-5-mini"]);
    });

    /** @scenario A legacy project key cannot mint keys beyond its own project */
    it("refuses org-scoped creation for a legacy project key", async () => {
      const { status, body } = await createVk({
        name: `legacy-org-${suffix}`,
        scopes: [{ scope_type: "ORGANIZATION", scope_id: ORG_ID }],
      });
      expect(status).toBe(403);
      expect(body.error.type).toBe("permission_denied");
      expect(body.error.message).toContain("virtualKeys:manage");
    });

    /** @scenario An org-admin API key provisions an org-scoped key */
    it("creates an org-scoped key for an org-admin API key", async () => {
      const { status, body } = await createVk(
        {
          name: `org-scoped-${suffix}`,
          scopes: [{ scope_type: "ORGANIZATION", scope_id: ORG_ID }],
        },
        apiKeyAuth(adminToken),
      );
      expect(status).toBe(201);
      expect(body.virtual_key.scopes).toEqual([
        { scope_type: "ORGANIZATION", scope_id: ORG_ID },
      ]);
    });

    /** @scenario A member API key passes the route gate but not per-scope manage */
    it("refuses creation when the key can create but not manage the scope", async () => {
      // MEMBER holds virtualKeys:create (route ceiling passes) but not
      // virtualKeys:manage — the per-scope gate the tRPC create enforces.
      // If REST ever stops running the shared per-scope assert, this
      // returns 201 and fails.
      const { status, body } = await createVk(
        { name: `member-denied-${suffix}` },
        apiKeyAuth(memberToken),
      );
      expect(status).toBe(403);
      expect(body.error.message).toContain("virtualKeys:manage");
    });

    /** @scenario Org-scoped key creation without a governance project is refused */
    it("refuses an org-scoped key when no governance project exists", async () => {
      const { status, body } = await createVk(
        {
          name: `nogov-${suffix}`,
          scopes: [{ scope_type: "ORGANIZATION", scope_id: NOGOV_ORG_ID }],
        },
        apiKeyAuth(nogovAdminToken, NOGOV_PROJECT_ID),
      );
      expect(status).toBe(400);
      expect(body.error.code).toBe("trace_project_required");
    });

    /** @scenario An explicit trace destination gives an org-scoped key a home for its spend */
    it("accepts trace_project_id where the governance fallback is absent", async () => {
      // Same org that just refused above: the explicit destination is what
      // makes the difference, through the same service resolution.
      const { status, body } = await createVk(
        {
          name: `nogov-explicit-${suffix}`,
          scopes: [{ scope_type: "ORGANIZATION", scope_id: NOGOV_ORG_ID }],
          trace_project_id: NOGOV_PROJECT_ID,
        },
        apiKeyAuth(nogovAdminToken, NOGOV_PROJECT_ID),
      );
      expect(status).toBe(201);
      expect(body.virtual_key.trace_project_id).toBe(NOGOV_PROJECT_ID);
    });

    /** @scenario An explicit trace destination gives an org-scoped key a home for its spend */
    it("refuses a sibling team's project as the trace destination", async () => {
      // Choosing a destination routes spend into that project, so it
      // demands manage there: a legacy key cannot point at a sibling
      // team's project.
      const denied = await createVk({
        name: `sibling-dest-${suffix}`,
        trace_project_id: SIBLING_PROJECT_ID,
      });
      expect(denied.status).toBe(403);
    });

    /** @scenario Cross-org scopes are rejected */
    it("refuses scopes from another organization", async () => {
      const { status, body } = await createVk(
        {
          name: `cross-org-${suffix}`,
          scopes: [{ scope_type: "PROJECT", scope_id: FOREIGN_PROJECT_ID }],
        },
        apiKeyAuth(adminToken),
      );
      // Fail-closed via the shared org-integrity assert: the foreign scope
      // never reaches a write, and the error names the mismatch rather
      // than a generic denial. The code is the handled one both doors
      // raise, not a prefix parsed out of the message.
      expect(status).toBe(400);
      expect(body.error.code).toBe("gateway_scope_org_mismatch");
    });

    /** @scenario routing_mode POLICY requires a routing policy id */
    it("refuses POLICY routing without a policy id", async () => {
      const { status, body } = await createVk({
        name: `policy-less-${suffix}`,
        routing_mode: "POLICY",
      });
      expect(status).toBe(400);
      expect(body.error.code).toBe("routing_policy_required");
    });

    /** @scenario The product-managed purpose cannot be minted over REST */
    it("refuses purpose langy", async () => {
      const { status, body } = await createVk({
        name: `langy-nope-${suffix}`,
        purpose: "langy",
      });
      expect(status).toBe(400);
      expect(body.error.code).toBe("validation_error");
    });

    /** @scenario A key and its cap are created atomically over REST */
    it("creates the key's own budget alongside it", async () => {
      const { status, body } = await createVk({
        name: `capped-${suffix}`,
        budget: { limit_usd: "12.50", window: "MONTH" },
      });
      expect(status).toBe(201);
      const budget = await prisma.gatewayBudget.findFirst({
        where: {
          organizationId: ORG_ID,
          scopeType: "VIRTUAL_KEY",
          scopeId: body.virtual_key.id,
          archivedAt: null,
        },
      });
      expect(budget).not.toBeNull();
      expect(budget!.limitUsd.toString()).toBe("12.5");
      expect(budget!.window).toBe("MONTH");
    });

    /** @scenario A malformed cap is refused with the shared validation */
    it("refuses a malformed budget via the same schema tRPC uses", async () => {
      const { status, body } = await createVk({
        name: `bad-cap-${suffix}`,
        budget: { limit_usd: "10abs", window: "MONTH" },
      });
      expect(status).toBe(400);
      expect(body.error.code).toBe("validation_error");
      expect(body.error.message).toContain("limit_usd");
    });
  });

  // ── Virtual keys: read, update, rotate, revoke ────────────────────────

  describe("virtual key lifecycle", () => {
    /** @scenario Writes from a scoped API key are attributed to its user */
    it("audits scoped-API-key writes as the owning user", async () => {
      const { status, body } = await createVk(
        { name: `audited-${suffix}` },
        apiKeyAuth(adminToken),
      );
      expect(status).toBe(201);
      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_ID,
          action: "gateway.virtual_key.created",
          targetId: body.virtual_key.id,
        },
      });
      expect(audit?.userId).toBe(ADMIN_USER_ID);
    });

    /** @scenario Writes from a legacy project key are attributed to the machine principal */
    it("audits legacy-key writes as svc_<projectId>", async () => {
      const { body } = await createVk({ name: `machine-audited-${suffix}` });
      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_ID,
          action: "gateway.virtual_key.created",
          targetId: body.virtual_key.id,
        },
      });
      expect(audit?.userId).toBe(`svc_${PROJECT_ID}`);
    });

    /** @scenario A sibling team's keys are invisible to the project credential */
    it("does not list or serve another team's project-scoped keys", async () => {
      const sibling = await createVk(
        { name: `sibling-${suffix}` },
        legacyAuth(SIBLING_LEGACY_KEY),
      );
      expect(sibling.status).toBe(201);

      const list = await app.request("/api/gateway/v1/virtual-keys", {
        headers: legacyAuth(),
      });
      const { data } = await list.json();
      expect(
        data.some((vk: any) => vk.id === sibling.body.virtual_key.id),
      ).toBe(false);

      const get = await app.request(
        `/api/gateway/v1/virtual-keys/${sibling.body.virtual_key.id}`,
        { headers: legacyAuth() },
      );
      expect(get.status).toBe(404);
    });

    /** @scenario Update renames and re-caps a key through the shared service */
    it("updates name and budget, leaving unspecified fields alone", async () => {
      const created = await createVk({
        name: `updatable-${suffix}`,
        description: "before",
      });
      const res = await patch(
        `/api/gateway/v1/virtual-keys/${created.body.virtual_key.id}`,
        {
          name: `updated-${suffix}`,
          budget: { limit_usd: "3", window: "DAY" },
        },
        legacyAuth(),
      );
      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.virtual_key.name).toBe(`updated-${suffix}`);
      expect(updated.virtual_key.description).toBe("before");
      const budget = await prisma.gatewayBudget.findFirst({
        where: {
          organizationId: ORG_ID,
          scopeType: "VIRTUAL_KEY",
          scopeId: created.body.virtual_key.id,
          archivedAt: null,
        },
      });
      expect(budget?.window).toBe("DAY");
    });

    /** @scenario Re-scoping over REST demands manage at the new scope */
    it("refuses a legacy key widening a key to org scope", async () => {
      const created = await createVk({ name: `rescope-${suffix}` });
      const res = await patch(
        `/api/gateway/v1/virtual-keys/${created.body.virtual_key.id}`,
        { scopes: [{ scope_type: "ORGANIZATION", scope_id: ORG_ID }] },
        legacyAuth(),
      );
      expect(res.status).toBe(403);
    });

    /** @scenario Rotate returns a fresh secret exactly once */
    it("rotates the secret", async () => {
      const created = await createVk({ name: `rotatable-${suffix}` });
      const res = await post(
        `/api/gateway/v1/virtual-keys/${created.body.virtual_key.id}/rotate`,
        {},
        legacyAuth(),
      );
      expect(res.status).toBe(200);
      const rotated = await res.json();
      expect(rotated.secret).toMatch(/^vk-lw-/);
      expect(rotated.secret).not.toBe(created.body.secret);
    });

    /** @scenario Revoke is idempotent and archives the key's cap */
    it("revokes idempotently and retires the key's budget", async () => {
      const created = await createVk({
        name: `revocable-${suffix}`,
        budget: { limit_usd: "5", window: "MONTH" },
      });
      const id = created.body.virtual_key.id;
      const first = await post(
        `/api/gateway/v1/virtual-keys/${id}/revoke`,
        {},
        legacyAuth(),
      );
      expect(first.status).toBe(200);
      expect((await first.json()).virtual_key.status).toBe("revoked");

      const second = await post(
        `/api/gateway/v1/virtual-keys/${id}/revoke`,
        {},
        legacyAuth(),
      );
      expect(second.status).toBe(200);
      expect((await second.json()).virtual_key.status).toBe("revoked");

      const budgets = await prisma.gatewayBudget.findMany({
        where: {
          organizationId: ORG_ID,
          scopeType: "VIRTUAL_KEY",
          scopeId: id,
        },
      });
      expect(budgets.length).toBeGreaterThan(0);
      expect(budgets.every((b) => b.archivedAt !== null)).toBe(true);
    });

    /** @scenario Product-managed keys refuse customer-facing reads and mutations */
    it("hides a langy-purpose key from get and refuses rotation", async () => {
      const langyVkId = `vk_gwrest_langy_${suffix}`;
      await prisma.virtualKey.create({
        data: {
          id: langyVkId,
          organizationId: ORG_ID,
          name: `langy-${suffix}`,
          hashedSecret: `hashed-${nanoid()}`,
          displayPrefix: "vk-lw-langy",
          purpose: "LANGY",
          createdById: `svc_${PROJECT_ID}`,
          scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
        },
      });
      const get = await app.request(
        `/api/gateway/v1/virtual-keys/${langyVkId}`,
        { headers: legacyAuth() },
      );
      expect(get.status).toBe(404);
      const rotate = await post(
        `/api/gateway/v1/virtual-keys/${langyVkId}/rotate`,
        {},
        legacyAuth(),
      );
      expect(rotate.status).toBe(404);
    });
  });

  // ── Budgets ───────────────────────────────────────────────────────────

  describe("budgets", () => {
    /** @scenario A VK-scoped budget created over REST is visible in the REST list */
    it("lists VIRTUAL_KEY and PRINCIPAL scoped budgets it created", async () => {
      const vk = await createVk({ name: `budget-target-${suffix}` });
      const createRes = await post(
        "/api/gateway/v1/budgets",
        {
          scope: {
            kind: "VIRTUAL_KEY",
            virtual_key_id: vk.body.virtual_key.id,
          },
          name: `vk-budget-${suffix}`,
          window: "MONTH",
          limit_usd: 25,
        },
        legacyAuth(),
      );
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      expect(created.budget.scope_type).toBe("VIRTUAL_KEY");

      const principalRes = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "PRINCIPAL", principal_user_id: MEMBER_USER_ID },
          name: `principal-budget-${suffix}`,
          window: "MONTH",
          limit_usd: 10,
        },
        legacyAuth(),
      );
      expect(principalRes.status).toBe(201);

      // Create-then-list must round-trip: this list hid VIRTUAL_KEY and
      // PRINCIPAL scopes entirely before #6261.
      const list = await app.request("/api/gateway/v1/budgets", {
        headers: legacyAuth(),
      });
      expect(list.status).toBe(200);
      const listBody = await list.json();
      expect(listBody.spend_available).toBe(true);
      const scopeTypes = new Set(
        listBody.data.map((b: any) => b.scope_type as string),
      );
      expect(scopeTypes.has("VIRTUAL_KEY")).toBe(true);
      expect(scopeTypes.has("PRINCIPAL")).toBe(true);

      const filtered = await app.request(
        "/api/gateway/v1/budgets?scope_type=VIRTUAL_KEY",
        { headers: legacyAuth() },
      );
      const filteredBody = await filtered.json();
      expect(filteredBody.data.length).toBeGreaterThan(0);
      expect(
        filteredBody.data.every((b: any) => b.scope_type === "VIRTUAL_KEY"),
      ).toBe(true);

      const excluded = await app.request(
        "/api/gateway/v1/budgets?scope_type=ORGANIZATION,TEAM",
        { headers: legacyAuth() },
      );
      const excludedBody = await excluded.json();
      expect(
        excludedBody.data.some((b: any) => b.scope_type === "VIRTUAL_KEY"),
      ).toBe(false);
    });

    /** @scenario An invalid scope_type filter is refused */
    it("rejects an unknown scope_type value", async () => {
      const res = await app.request(
        "/api/gateway/v1/budgets?scope_type=BANANA",
        { headers: legacyAuth() },
      );
      expect(res.status).toBe(400);
    });

    /** @scenario A PRINCIPAL budget must target a member of the org */
    it("refuses a PRINCIPAL budget for a non-member", async () => {
      const res = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "PRINCIPAL", principal_user_id: OUTSIDE_USER_ID },
          name: `outsider-${suffix}`,
          window: "MONTH",
          limit_usd: 5,
        },
        legacyAuth(),
      );
      expect(res.status).toBe(400);
    });

    /** @scenario A TEAM budget cannot target another org's team */
    it("refuses a TEAM budget for a foreign team", async () => {
      const res = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "TEAM", team_id: FOREIGN_TEAM_ID },
          name: `foreign-team-${suffix}`,
          window: "MONTH",
          limit_usd: 5,
        },
        legacyAuth(),
      );
      expect(res.status).toBe(400);
    });

    /** @scenario A GROUP budget over REST carries the per-member semantics */
    it("creates a GROUP budget and labels it with member_count", async () => {
      const res = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "GROUP", group_id: GROUP_ID },
          name: `group-budget-${suffix}`,
          window: "MONTH",
          limit_usd: "40",
        },
        legacyAuth(),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.budget.scope_type).toBe("GROUP");
      expect(body.budget.member_count).toBe(2);

      const list = await app.request(
        "/api/gateway/v1/budgets?scope_type=GROUP",
        { headers: legacyAuth() },
      );
      const listBody = await list.json();
      const row = listBody.data.find((b: any) => b.scope_id === GROUP_ID);
      expect(row.member_count).toBe(2);
      // limit_usd is the PER-MEMBER allowance; spent_usd sums the group.
      expect(row.limit_usd).toBe("40");
    });

    /** @scenario An ATTRIBUTED_USER budget over REST carries the per-person standing */
    it("labels a per-person template with end_users_seen and end_users_over", async () => {
      const vk = await createVk({ name: `seat-vk-${suffix}` });
      const anchorId = vk.body.virtual_key.id;
      const createRes = await post(
        "/api/gateway/v1/budgets",
        {
          scope: {
            kind: "ATTRIBUTED_USER",
            anchor_virtual_key_id: anchorId,
          },
          name: `seat-budget-${suffix}`,
          window: "MONTH",
          limit_usd: "1",
        },
        legacyAuth(),
      );
      expect(createRes.status).toBe(201);
      const budgetId = (await createRes.json()).budget.id;

      // Two people on the anchor, one of them at the cap. The per-user
      // buckets are the only place this spend exists; the template's own
      // scope id never accrues a row.
      const chRepo = new GatewayBudgetClickHouseRepository(async () => ch());
      for (const [endUserId, amountUsd] of [
        ["seat-over", "1.500000"],
        ["seat-under", "0.250000"],
      ]) {
        await chRepo.insertDebit([
          {
            tenantId: PROJECT_ID,
            budgetId,
            scope: "ATTRIBUTED_USER",
            scopeId: `${anchorId}:${endUserId}`,
            window: "MONTH",
            virtualKeyId: anchorId,
            gatewayRequestId: `req-seat-${endUserId}-${suffix}`,
            amountUsd: amountUsd!,
            tokensInput: 10,
            tokensOutput: 5,
            tokensCacheRead: 0,
            tokensCacheWrite: 0,
            model: "gpt-5-mini",
            status: "SUCCESS",
            occurredAt: new Date(),
          },
        ]);
      }

      const list = await app.request(
        "/api/gateway/v1/budgets?scope_type=ATTRIBUTED_USER",
        { headers: legacyAuth() },
      );
      const listBody = await list.json();
      const row = listBody.data.find((b: any) => b.id === budgetId);
      expect(row).toBeDefined();
      // limit_usd is the PER-PERSON cap; the standing is the pair.
      expect(row.limit_usd).toBe("1");
      expect(row.end_users_seen).toBe(2);
      expect(row.end_users_over).toBe(1);
    });

    /** @scenario An ATTRIBUTED_USER budget over REST carries the per-person standing */
    it("leaves both per-person fields off every other scope", async () => {
      const createRes = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "PROJECT", project_id: PROJECT_ID },
          name: `no-seats-budget-${suffix}`,
          window: "MONTH",
          limit_usd: 30,
        },
        legacyAuth(),
      );
      expect(createRes.status).toBe(201);

      const list = await app.request(
        "/api/gateway/v1/budgets?scope_type=PROJECT",
        { headers: legacyAuth() },
      );
      const listBody = await list.json();
      expect(listBody.data.length).toBeGreaterThan(0);
      for (const row of listBody.data) {
        expect(row.end_users_seen).toBeUndefined();
        expect(row.end_users_over).toBeUndefined();
      }
    });

    /** @scenario A GROUP budget cannot target another org's group */
    it("refuses a foreign tenant naming this org's group", async () => {
      const res = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "GROUP", group_id: GROUP_ID },
          name: `foreign-group-${suffix}`,
          window: "MONTH",
          limit_usd: 5,
        },
        legacyAuth(FOREIGN_LEGACY_KEY),
      );
      expect(res.status).toBe(400);
    });

    /** @scenario A provider-filtered budget round-trips provider_key */
    it("creates and echoes a provider-filtered budget", async () => {
      const res = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "PROJECT", project_id: PROJECT_ID },
          name: `provider-budget-${suffix}`,
          window: "MONTH",
          limit_usd: 15,
          provider_key: MP_OPENAI_ID,
        },
        legacyAuth(),
      );
      expect(res.status).toBe(201);
      expect((await res.json()).budget.provider_key).toBe(MP_OPENAI_ID);

      const foreign = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "PROJECT", project_id: FOREIGN_PROJECT_ID },
          name: `foreign-provider-${suffix}`,
          window: "MONTH",
          limit_usd: 15,
          provider_key: MP_OPENAI_ID,
        },
        legacyAuth(FOREIGN_LEGACY_KEY),
      );
      // A cross-org provider id is refused by the shared service's
      // org-integrity assert, in this surface's one error envelope: the
      // handled code, plus the meta naming which scope was foreign, since
      // the copy itself never names another tenant's id.
      expect(foreign.status).toBe(400);
      const foreignBody = await foreign.json();
      expect(foreignBody.error.code).toBe("gateway_scope_org_mismatch");
      expect(foreignBody.error.meta.scopeKind).toBe("model provider");
    });

    /** @scenario REST budget spend is the live ClickHouse ledger, not the stale PG column */
    it("serves ledger spend for listed budgets", async () => {
      const vk = await createVk({ name: `ledger-vk-${suffix}` });
      const vkId = vk.body.virtual_key.id;
      const createRes = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "VIRTUAL_KEY", virtual_key_id: vkId },
          name: `ledger-budget-${suffix}`,
          window: "MONTH",
          limit_usd: 100,
        },
        legacyAuth(),
      );
      const budgetId = (await createRes.json()).budget.id;

      const chRepo = new GatewayBudgetClickHouseRepository(async () => ch());
      await chRepo.insertDebit([
        {
          tenantId: PROJECT_ID,
          budgetId,
          scope: "VIRTUAL_KEY",
          scopeId: vkId,
          window: "MONTH",
          virtualKeyId: vkId,
          gatewayRequestId: `req-gwrest-${suffix}`,
          amountUsd: "1.2500",
          tokensInput: 10,
          tokensOutput: 5,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          model: "gpt-5-mini",
          status: "SUCCESS",
          occurredAt: new Date(),
        },
      ]);

      // The PG column is untouched — only the ledger knows this spend. A
      // REST service constructed without the ClickHouse repository (the
      // #6248 wiring bug) reports "0" here and fails.
      const pgRow = await prisma.gatewayBudget.findUnique({
        where: { id: budgetId },
      });
      expect(pgRow!.spentUsd.toString()).toBe("0");

      const list = await app.request(
        "/api/gateway/v1/budgets?scope_type=VIRTUAL_KEY",
        { headers: legacyAuth() },
      );
      const listBody = await list.json();
      const row = listBody.data.find((b: any) => b.id === budgetId);
      expect(row).toBeDefined();
      expect(Number(row.spent_usd)).toBeCloseTo(1.25, 4);
    });

    /** @scenario Budget update and archive over REST */
    it("updates and archives a budget", async () => {
      const createRes = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "PROJECT", project_id: PROJECT_ID },
          name: `mutable-budget-${suffix}`,
          window: "MONTH",
          limit_usd: 30,
        },
        legacyAuth(),
      );
      const id = (await createRes.json()).budget.id;

      const updateRes = await patch(
        `/api/gateway/v1/budgets/${id}`,
        { limit_usd: 45, on_breach: "WARN" },
        legacyAuth(),
      );
      expect(updateRes.status).toBe(200);
      const updated = await updateRes.json();
      expect(updated.budget.limit_usd).toBe("45");
      expect(updated.budget.on_breach).toBe("WARN");

      const deleteRes = await app.request(`/api/gateway/v1/budgets/${id}`, {
        method: "DELETE",
        headers: legacyAuth(),
      });
      expect(deleteRes.status).toBe(200);
      expect((await deleteRes.json()).budget.archived_at).not.toBeNull();
    });
  });

  // ── Per-key spend ─────────────────────────────────────────────────────

  describe("virtual key spend read", () => {
    /** @scenario A fresh key reports zero spend for the current month */
    it("returns an honest zero with the window echoed", async () => {
      const vk = await createVk({ name: `zero-spend-${suffix}` });
      const res = await app.request(
        `/api/gateway/v1/virtual-keys/${vk.body.virtual_key.id}/spend`,
        { headers: legacyAuth() },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.spent_usd).toBe("0");
      expect(body.requests).toBe(0);
      expect(new Date(body.window.from).getUTCDate()).toBe(1);
    });

    /** @scenario Key spend over REST reads the same trace_summaries the UI reads */
    it("sums the key's cost-path spend", async () => {
      const vk = await createVk({ name: `spender-${suffix}` });
      const vkId = vk.body.virtual_key.id;
      await insertGatewayTrace({
        tenantId: PROJECT_ID,
        traceId: `trace-gwrest-a-${suffix}`,
        virtualKeyId: vkId,
        occurredAt: new Date(Date.now() - 60_000),
        totalCost: 0.75,
      });
      await insertGatewayTrace({
        tenantId: PROJECT_ID,
        traceId: `trace-gwrest-b-${suffix}`,
        virtualKeyId: vkId,
        occurredAt: new Date(Date.now() - 30_000),
        totalCost: 0.5,
      });

      const res = await app.request(
        `/api/gateway/v1/virtual-keys/${vkId}/spend`,
        { headers: legacyAuth() },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Number(body.spent_usd)).toBeCloseTo(1.25, 4);
      expect(body.requests).toBe(2);
    });

    /** @scenario The spend read validates its window */
    it("refuses an inverted window", async () => {
      const vk = await createVk({ name: `windowed-${suffix}` });
      const res = await app.request(
        `/api/gateway/v1/virtual-keys/${vk.body.virtual_key.id}/spend?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z`,
        { headers: legacyAuth() },
      );
      expect(res.status).toBe(400);
    });

    /** @scenario Spend for an unknown key is a 404, not a zero */
    it("404s for an unknown key id", async () => {
      const res = await app.request(
        `/api/gateway/v1/virtual-keys/vk_does_not_exist/spend`,
        { headers: legacyAuth() },
      );
      expect(res.status).toBe(404);
    });
  });
});
