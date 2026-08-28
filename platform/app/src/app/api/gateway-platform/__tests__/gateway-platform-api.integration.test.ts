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

import crypto from "node:crypto";
import type { ClickHouseClient } from "@clickhouse/client";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";

import { readStoredBody, serializeResponseBody, withIdempotency } from "~/server/api/idempotency";
import { getApp } from "~/server/app-layer/app";
import { holdClickHouseSchemaLockForFile } from "~/server/clickhouse/__tests__/holdSchemaLock";
import { prisma } from "~/server/db";
import {
  getTestClickHouseClient,
  startTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GatewayBudgetLedgerAdapter } from "@langwatch/gateway-server";
import { currentPeriodStart } from "@langwatch/gateway-server";
import { nextAnchoredResetAt } from "@langwatch/gateway-server";
import { clearClickHouseTestApp, installClickHouseTestApp } from "~/test-utils/clickhouseTestApp";
import { expectCanonicalError } from "~/test-utils/expectCanonicalError";
import { KSUID_RESOURCES } from "~/utils/constants";
import { createGatewayPlatformRestApp } from "@langwatch/platform-api";
import type { GatewayPlatformRestPorts, GatewayRestActor } from "@langwatch/platform-api";
import {
  GatewayUsageService,
  loadTraceDestinationFacts,
  toVirtualKeySnakeDto,
} from "@langwatch/gateway-server";
import { appRestSecurity } from "~/server/api/security";
import {
  assertActorCanManageAllScopes,
  assertActorCanOperateOnAnyScope,
  assertGuardrailAttachmentsAllowed,
  assertScopesBelongToOrg,
  assertTraceProjectBelongsToOrg,
  isVisibleToMembership,
  type MembershipSet,
  requireExistingVk,
  requireVisibleVk,
  resolveVkProjectId,
  type VirtualKeyActor,
} from "~/server/gateway/virtualKey.authz";
import { virtualKeyBudgetInputSchema } from "~/server/gateway/virtualKey.service";
import type { Permission } from "~/server/api/rbac";
import type { GuardrailAttachment } from "@langwatch/gateway-contract";

/**
 * A project credential stands in for someone working in its project, so it
 * sees organization-scoped keys, its own team's keys and its own project's.
 */
function membershipForProjectCredential(project: { id: string; teamId: string }): MembershipSet {
  return {
    isOrgMember: true,
    isOrgAdmin: false,
    teamIds: new Set([project.teamId]),
    projectIds: new Set([project.id]),
  };
}

/**
 * The process's receipt ledger, as the family's port takes it. Declared as a
 * generic function rather than an arrow so the port's own type parameter
 * survives the assignment.
 */
function runIdempotently<T>(input: {
  operation: string;
  scopeId: string;
  key: string | null;
  validatedBody: unknown;
  handler: () => Promise<{ status: number; body: T }>;
}) {
  return withIdempotency({ prisma, ...input });
}

/**
 * The same ports `api-router.ts` composes for the mounted family, so what is
 * exercised here is what production serves. Resolved per request, which is
 * what lets a test install a different App between cases.
 */
function gatewayPlatformRestPorts(): GatewayPlatformRestPorts {
  const current = getApp();
  const asActor = (actor: GatewayRestActor) => actor as VirtualKeyActor;
  return {
    virtualKeys: current.gateway.virtualKeys,
    budgets: current.gateway.budgetDecisions,
    spendSourceAvailable: current.gateway.virtualKeySpend !== undefined,
    organizationIdForProject: async (projectId) => {
      const found = await prisma.project.findUnique({
        where: { id: projectId },
        include: { team: true },
      });
      if (!found) throw new Error(`project ${projectId} missing team`);
      return found.team.organizationId;
    },
    actorForCredential: ({ projectId, resolvedToken }) =>
      resolvedToken?.type === "apiKey"
        ? {
            actor: {
              kind: "apiKey",
              apiKeyId: resolvedToken.apiKeyId,
              userId: resolvedToken.userId,
              organizationId: resolvedToken.organizationId,
            },
            actorUserId: resolvedToken.userId ?? `svc_${projectId}`,
          }
        : {
            actor: { kind: "legacyProjectKey", projectId },
            actorUserId: `svc_${projectId}`,
          },
    visibleToProjectCredential: ({ project, virtualKeys }) => {
      const membership = membershipForProjectCredential(project);
      return virtualKeys.filter((vk) => isVisibleToMembership(membership, vk.scopes));
    },
    requireVisibleVirtualKey: ({ project, id, organizationId }) =>
      requireVisibleVk(current.gateway.virtualKeys, membershipForProjectCredential(project), {
        id,
        organizationId,
      }),
    requireExistingVirtualKey: ({ id, organizationId }) =>
      requireExistingVk(current.gateway.virtualKeys, id, organizationId),
    assertCanManageAllScopes: ({ actor, scopes }) =>
      assertActorCanManageAllScopes({ prisma, actor: asActor(actor) }, [...scopes]),
    assertCanOperateOnAnyScope: ({ actor, scopes, permission }) =>
      assertActorCanOperateOnAnyScope(
        { prisma, actor: asActor(actor) },
        [...scopes],
        permission as Permission,
      ),
    assertScopesBelongToOrganization: ({ organizationId, scopes }) =>
      assertScopesBelongToOrg(prisma, organizationId, [...scopes]),
    assertTraceProjectBelongsToOrganization: ({ organizationId, traceProjectId }) =>
      assertTraceProjectBelongsToOrg(prisma, organizationId, traceProjectId),
    assertGuardrailAttachmentsAllowed: ({ actor, projectId, attachments }) =>
      assertGuardrailAttachmentsAllowed(
        { prisma, actor: asActor(actor) },
        projectId,
        attachments as GuardrailAttachment[] | undefined,
      ),
    resolveVirtualKeyProjectId: ({ organizationId, virtualKeyId, scopes, traceProjectId }) =>
      resolveVkProjectId(prisma, organizationId, {
        vkId: virtualKeyId,
        inputScopes: scopes ? [...scopes] : undefined,
        traceProjectId,
      }),
    toVirtualKeyDtos: async ({ virtualKeys }) => {
      const facts = await loadTraceDestinationFacts({
        projects: current.projects,
        virtualKeys: [...virtualKeys],
      });
      return virtualKeys.map((virtualKey) => toVirtualKeySnakeDto({ virtualKey, facts }));
    },
    groupMemberCounts: async (budgets) => {
      const groupIds = Array.from(
        new Set(budgets.filter((b) => b.scopeType === "GROUP").map((b) => b.scopeId)),
      );
      if (groupIds.length === 0) return new Map();
      const groups = await prisma.group.findMany({
        where: { id: { in: groupIds } },
        select: { id: true, _count: { select: { members: true } } },
      });
      return new Map(groups.map((g) => [g.id, g._count.members]));
    },
    spendByVirtualKey: ({ organizationId, virtualKeyIds, window }) =>
      GatewayUsageService.create({
        prisma,
        chRepo: undefined,
        spendRepo: current.gateway.virtualKeySpend,
      }).spendByVirtualKey({
        organizationId,
        virtualKeyIds: [...virtualKeyIds],
        window,
      }),
    idempotency: runIdempotently,
    schemas: { virtualKeyBudgetInput: virtualKeyBudgetInputSchema },
  };
}

const { hono: app } = createGatewayPlatformRestApp({
  security: appRestSecurity,
  gateway: gatewayPlatformRestPorts,
});

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
const ALL_USER_IDS = [ADMIN_USER_ID, MEMBER_USER_ID, VIEWER_USER_ID, OUTSIDE_USER_ID];
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

function apiKeyAuth(token: string, projectId: string = PROJECT_ID): Record<string, string> {
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

type Page = { data: Array<{ id: string }>; next_cursor: string | null };

function pageUrl(path: string, limit: number, cursor: string | null): string {
  const sep = path.includes("?") ? "&" : "?";
  const at = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
  return `${path}${sep}limit=${limit}${at}`;
}

async function fetchPage(url: string): Promise<Page> {
  const res = await app.request(url, { headers: legacyAuth() });
  if (res.status !== 200) {
    throw new Error(`${url} answered ${res.status}`);
  }
  return (await res.json()) as Page;
}

/**
 * Every page of `path`, walked to exhaustion at `limit` rows a page.
 *
 * Throws rather than asserts, so the assertions all live in the `it` that
 * called it and a failure names the walk that produced it. The page cap means
 * a cursor that fails to advance fails the test instead of hanging the suite.
 */
async function pagesOf(path: string, limit: number): Promise<Page[]> {
  const pages: Page[] = [];
  let cursor: string | null = null;
  do {
    const page = await fetchPage(pageUrl(path, limit, cursor));
    pages.push(page);
    cursor = page.next_cursor;
  } while (cursor !== null && pages.length < 50);
  if (cursor !== null) {
    throw new Error(`walk of ${path} never exhausted its cursor`);
  }
  return pages;
}

function idsOf(pages: Page[]): string[] {
  return pages.flatMap((page) => page.data.map((row) => row.id));
}

async function walkAll(path: string, limit: number): Promise<string[]> {
  return idsOf(await pagesOf(path, limit));
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
  const created = await getApp().apiKeys.create({
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

// Held for the whole file. The rollup this suite writes to and reads back is
// database-wide, so a neighbouring suite rebuilding it drops the materialised
// view out from under these fixtures.
holdClickHouseSchemaLockForFile();

describe("gateway platform REST API (real PG + real CH)", () => {
  beforeAll(async () => {
    await startTestContainers();

    // The routes and workers under test take their ClickHouse repositories
    // from the App rather than resolving a client, so the fixture has to
    // provide one or they fail with "App not initialized".
    installClickHouseTestApp({
      resolveClient: async () => getTestClickHouseClient(),
    });
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
    await clearClickHouseTestApp();
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
      // A refusal one layer beneath the handlers still answers the shape this
      // family publishes, with the SAME code the org-scoped families under
      // this prefix answer, so a caller writes exactly one error reader.
      expect(await res.json()).toMatchObject({
        error: { type: "unauthenticated", code: "missing_credentials" },
      });
    });

    /** @scenario Every gateway platform refusal is the canonical envelope */
    it("refuses at the API key ceiling in the canonical envelope", async () => {
      const res = await createVk({ name: "denied-by-ceiling" }, apiKeyAuth(viewerToken));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        error: {
          type: "permission_denied",
          code: "api_key_permission_denied",
        },
      });
    });

    /** @scenario Provider binding routes are gone since the ModelProvider fold */
    it("returns 410 for the folded provider-binding routes", async () => {
      const res = await app.request("/api/gateway/v1/providers", {
        headers: legacyAuth(),
      });
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body).toMatchObject({
        error: { type: "gone", code: "gateway_provider_bindings_gone" },
      });
      // A 410 without a forwarding address is a dead end for SDK authors.
      expect(body.error.message).toContain("model-providers");
    });

    /** @scenario A viewer-scoped API key can list but not create virtual keys */
    it("viewer API key: GET 200, POST 403 at the ceiling", async () => {
      const list = await app.request("/api/gateway/v1/virtual-keys", {
        headers: apiKeyAuth(viewerToken),
      });
      expect(list.status).toBe(200);

      const create = await createVk({ name: `viewer-denied-${suffix}` }, apiKeyAuth(viewerToken));
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
      expect(body.virtual_key.scopes).toEqual([{ scope_type: "project", scope_id: PROJECT_ID }]);
      expect(body.virtual_key.routing_mode).toBe("none");
      expect(body.virtual_key.purpose).toBe("user");
      expect(body.virtual_key.status).toBe("active");
      // The ghost of the deleted GatewayProviderCredential entity must be
      // gone from the wire in both directions.
      expect(body.virtual_key).not.toHaveProperty("provider_credential_ids");

      const get = await app.request(`/api/gateway/v1/virtual-keys/${body.virtual_key.id}`, {
        headers: legacyAuth(),
      });
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
        scopes: [{ scope_type: "project", scope_id: PROJECT_ID }],
        routing_mode: "fallback_all",
        config: { modelsAllowed: ["gpt-5-mini"] },
      });
      expect(status).toBe(201);
      expect(body.virtual_key.routing_mode).toBe("fallback_all");
      expect(body.virtual_key.config.modelsAllowed).toEqual(["gpt-5-mini"]);
    });

    /** @scenario A legacy project key cannot mint keys beyond its own project */
    it("refuses org-scoped creation for a legacy project key", async () => {
      const { status, body } = await createVk({
        name: `legacy-org-${suffix}`,
        scopes: [{ scope_type: "organization", scope_id: ORG_ID }],
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
          scopes: [{ scope_type: "organization", scope_id: ORG_ID }],
          // An organization with projects to choose from must say which
          // one its shared key traces into, rather than leave it to the
          // governance fallback. RBAC stays the only thing under test.
          trace_project_id: PROJECT_ID,
        },
        apiKeyAuth(adminToken),
      );
      expect(status).toBe(201);
      expect(body.virtual_key.scopes).toEqual([{ scope_type: "organization", scope_id: ORG_ID }]);
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
          scopes: [{ scope_type: "organization", scope_id: NOGOV_ORG_ID }],
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
          scopes: [{ scope_type: "organization", scope_id: NOGOV_ORG_ID }],
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
          scopes: [{ scope_type: "project", scope_id: FOREIGN_PROJECT_ID }],
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
        routing_mode: "policy",
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
        budget: { limit_usd: "12.50", window: "month" },
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
        budget: { limit_usd: "10abs", window: "month" },
      });
      expect(status).toBe(400);
      expect(body.error.code).toBe("validation_error");
      // The offending field is structured, in meta, rather than something a
      // caller has to scrape out of the sentence.
      expect(body.error.meta.target).toBe("json");
      expect(JSON.stringify(body.error.meta)).toContain("limit_usd");
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
      const sibling = await createVk({ name: `sibling-${suffix}` }, legacyAuth(SIBLING_LEGACY_KEY));
      expect(sibling.status).toBe(201);

      const list = await app.request("/api/gateway/v1/virtual-keys", {
        headers: legacyAuth(),
      });
      const { data } = await list.json();
      expect(data.some((vk: any) => vk.id === sibling.body.virtual_key.id)).toBe(false);

      const get = await app.request(`/api/gateway/v1/virtual-keys/${sibling.body.virtual_key.id}`, {
        headers: legacyAuth(),
      });
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
          budget: { limit_usd: "3", window: "day" },
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
        { scopes: [{ scope_type: "organization", scope_id: ORG_ID }] },
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
        budget: { limit_usd: "5", window: "month" },
      });
      const id = created.body.virtual_key.id;
      const first = await post(`/api/gateway/v1/virtual-keys/${id}/revoke`, {}, legacyAuth());
      expect(first.status).toBe(200);
      expect((await first.json()).virtual_key.status).toBe("revoked");

      const second = await post(`/api/gateway/v1/virtual-keys/${id}/revoke`, {}, legacyAuth());
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
      const get = await app.request(`/api/gateway/v1/virtual-keys/${langyVkId}`, {
        headers: legacyAuth(),
      });
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
            kind: "virtual_key",
            virtual_key_id: vk.body.virtual_key.id,
          },
          name: `vk-budget-${suffix}`,
          window: "month",
          limit_usd: 25,
        },
        legacyAuth(),
      );
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      expect(created.budget.scope_type).toBe("virtual_key");

      const principalRes = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "principal", principal_user_id: MEMBER_USER_ID },
          name: `principal-budget-${suffix}`,
          window: "month",
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
      const scopeTypes = new Set(listBody.data.map((b: any) => b.scope_type as string));
      expect(scopeTypes.has("virtual_key")).toBe(true);
      expect(scopeTypes.has("principal")).toBe(true);

      const filtered = await app.request("/api/gateway/v1/budgets?scope_type=virtual_key", {
        headers: legacyAuth(),
      });
      const filteredBody = await filtered.json();
      expect(filteredBody.data.length).toBeGreaterThan(0);
      expect(filteredBody.data.every((b: any) => b.scope_type === "virtual_key")).toBe(true);

      const excluded = await app.request("/api/gateway/v1/budgets?scope_type=organization,team", {
        headers: legacyAuth(),
      });
      const excludedBody = await excluded.json();
      expect(excludedBody.data.some((b: any) => b.scope_type === "virtual_key")).toBe(false);
    });

    /** @scenario One budget can be read on its own */
    it("serves a single budget in the list row shape", async () => {
      const created = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "project", project_id: PROJECT_ID },
          name: `single-read-${suffix}`,
          window: "month",
          limit_usd: "25.5",
        },
        legacyAuth(),
      );
      expect(created.status).toBe(201);
      const id = (await created.json()).budget.id;

      const res = await app.request(`/api/gateway/v1/budgets/${id}`, {
        headers: legacyAuth(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.spend_available).toBe(true);
      expect(body.budget).toMatchObject({
        id,
        scope_type: "project",
        window: "month",
        on_breach: "block",
        limit_usd: "25.5",
        limit_nano_usd: 25_500_000_000,
      });

      // The single read must be the SAME row the list serves, field for
      // field, or a caller has to learn two budget shapes.
      const list = await app.request("/api/gateway/v1/budgets", {
        headers: legacyAuth(),
      });
      const listed = (await list.json()).data.find((b: any) => b.id === id);
      expect(body.budget).toEqual(listed);
    });

    /** @scenario "Creating an anchored budget reports its true cycle on the wire" */
    it("echoes a cycle anchor and reports the anchored period, not the calendar one", async () => {
      // A few days back, at a time of day no calendar period starts on.
      const anchor = new Date(Date.now() - 5 * 86_400_000);
      anchor.setUTCHours(9, 0, 0, 0);

      const created = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "project", project_id: PROJECT_ID },
          name: `anchored-${suffix}`,
          window: "month",
          limit_usd: "40",
          cycle_anchor_at: anchor.toISOString(),
        },
        legacyAuth(),
      );
      expect(created.status).toBe(201);
      const budget = (await created.json()).budget;
      expect(budget.cycle_anchor_at).toBe(anchor.toISOString());

      // The reported period is the anchored one. Since the anchor is days
      // old and the window is a month, the period start IS the anchor and
      // the reset is one anchored month on, neither of which is a calendar
      // month boundary.
      expect(budget.current_period_started_at).toBe(anchor.toISOString());
      expect(budget.resets_at).toBe(
        nextAnchoredResetAt({
          window: "MONTH",
          anchorAt: anchor,
          now: new Date(),
        }).toISOString(),
      );
      expect(budget.resets_at).not.toBe(currentPeriodStart("MONTH", new Date()).toISOString());

      // Reading it back agrees, so a caller polling the budget sees the
      // same cycle the create call promised.
      const read = await app.request(`/api/gateway/v1/budgets/${budget.id}`, {
        headers: legacyAuth(),
      });
      expect(read.status).toBe(200);
      expect((await read.json()).budget).toEqual(budget);

      // The anchor is immutable: a patch naming it changes nothing, since
      // moving it would redraw periods already reported and enforced on.
      const patched = await patch(
        `/api/gateway/v1/budgets/${budget.id}`,
        { name: `anchored-renamed-${suffix}`, cycle_anchor_at: null },
        legacyAuth(),
      );
      expect(patched.status).toBe(200);
      const after = (await patched.json()).budget;
      expect(after.name).toBe(`anchored-renamed-${suffix}`);
      expect(after.cycle_anchor_at).toBe(anchor.toISOString());
      expect(after.current_period_started_at).toBe(budget.current_period_started_at);
    });

    /** @scenario "A cycle anchor is rejected on windows that do not cycle" */
    it("refuses a cycle anchor on the windows that never roll", async () => {
      for (const window of ["manual", "total"]) {
        const res = await post(
          "/api/gateway/v1/budgets",
          {
            scope: { kind: "project", project_id: PROJECT_ID },
            name: `anchored-${window}-${suffix}`,
            window,
            limit_usd: "10",
            cycle_anchor_at: "2026-01-17T09:00:00.000Z",
          },
          legacyAuth(),
        );
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
          error: {
            code: "gateway_budget_cycle_anchor_invalid",
            message: "That window does not cycle, so it cannot take a cycle anchor",
            meta: { window },
          },
        });
        expect(
          await prisma.gatewayBudget.findMany({
            where: {
              organizationId: ORG_ID,
              name: `anchored-${window}-${suffix}`,
            },
          }),
        ).toHaveLength(0);
      }

      // The same windows are fine without one.
      const ok = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "project", project_id: PROJECT_ID },
          name: `unanchored-manual-${suffix}`,
          window: "manual",
          limit_usd: "10",
        },
        legacyAuth(),
      );
      expect(ok.status).toBe(201);
      expect((await ok.json()).budget.cycle_anchor_at).toBeNull();
    });

    /** @scenario An absent budget answers a canonical 404 */
    it("answers 404 for a budget that does not exist", async () => {
      const res = await app.request("/api/gateway/v1/budgets/bgt_missing", {
        headers: legacyAuth(),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({
        error: { type: "not_found", code: "budget_not_found" },
      });
    });

    /** @scenario An invalid scope_type filter is refused */
    it("rejects an unknown scope_type value", async () => {
      const res = await app.request("/api/gateway/v1/budgets?scope_type=BANANA", {
        headers: legacyAuth(),
      });
      expect(res.status).toBe(400);
    });

    /** @scenario The wire enums are lowercase only, with no casing tolerance */
    it("refuses the stored casing of an enum on input", async () => {
      // The surface used to accept `scope_type=Group` on this filter (it
      // uppercased whatever arrived) while the create body's `kind` refused
      // the same spelling. One casing, both directions, no tolerance.
      const filter = await app.request("/api/gateway/v1/budgets?scope_type=VIRTUAL_KEY", {
        headers: legacyAuth(),
      });
      expect(filter.status).toBe(400);

      const create = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "PROJECT", project_id: PROJECT_ID },
          name: `stored-casing-${suffix}`,
          window: "MONTH",
          limit_usd: 5,
        },
        legacyAuth(),
      );
      expect(create.status).toBe(400);

      const vk = await createVk({
        name: `stored-casing-vk-${suffix}`,
        scopes: [{ scope_type: "PROJECT", scope_id: PROJECT_ID }],
      });
      expect(vk.status).toBe(400);
    });

    /** @scenario Every enum a budget read returns is lowercase */
    it("returns lowercase enums on every budget field", async () => {
      const created = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "project", project_id: PROJECT_ID },
          name: `lowercase-read-${suffix}`,
          window: "month",
          limit_usd: 9,
          on_breach: "warn",
        },
        legacyAuth(),
      );
      expect(created.status).toBe(201);
      const body = await created.json();
      expect(body.budget).toMatchObject({
        scope_type: "project",
        window: "month",
        on_breach: "warn",
      });
    });

    /** @scenario A PRINCIPAL budget must target a member of the org */
    it("refuses a PRINCIPAL budget for a non-member", async () => {
      const res = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "principal", principal_user_id: OUTSIDE_USER_ID },
          name: `outsider-${suffix}`,
          window: "month",
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
          scope: { kind: "team", team_id: FOREIGN_TEAM_ID },
          name: `foreign-team-${suffix}`,
          window: "month",
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
          scope: { kind: "group", group_id: GROUP_ID },
          name: `group-budget-${suffix}`,
          window: "month",
          limit_usd: "40",
          // None of these members hold a key, so the budget is unreachable
          // and would be refused. What is under test is the per-member
          // labelling, and reach has its own tests.
          allow_unreachable: true,
        },
        legacyAuth(),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.budget.scope_type).toBe("group");
      expect(body.budget.member_count).toBe(2);

      const list = await app.request("/api/gateway/v1/budgets?scope_type=group", {
        headers: legacyAuth(),
      });
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
            kind: "attributed_user",
            anchor_virtual_key_id: anchorId,
          },
          name: `seat-budget-${suffix}`,
          window: "month",
          limit_usd: "1",
        },
        legacyAuth(),
      );
      expect(createRes.status).toBe(201);
      const budgetId = (await createRes.json()).budget.id;

      // Two people on the anchor, one of them at the cap. The per-user
      // buckets are the only place this spend exists; the template's own
      // scope id never accrues a row.
      const chRepo = GatewayBudgetLedgerAdapter.create(async () => ch());
      for (const { endUserId, amountNanoUsd } of [
        { endUserId: "seat-over", amountNanoUsd: 1_500_000_000 },
        { endUserId: "seat-under", amountNanoUsd: 250_000_000 },
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
            amountNanoUsd,
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

      const list = await app.request("/api/gateway/v1/budgets?scope_type=attributed_user", {
        headers: legacyAuth(),
      });
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
          scope: { kind: "project", project_id: PROJECT_ID },
          name: `no-seats-budget-${suffix}`,
          window: "month",
          limit_usd: 30,
        },
        legacyAuth(),
      );
      expect(createRes.status).toBe(201);

      const list = await app.request("/api/gateway/v1/budgets?scope_type=project", {
        headers: legacyAuth(),
      });
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
          scope: { kind: "group", group_id: GROUP_ID },
          name: `foreign-group-${suffix}`,
          window: "month",
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
          scope: { kind: "project", project_id: PROJECT_ID },
          name: `provider-budget-${suffix}`,
          window: "month",
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
          scope: { kind: "project", project_id: FOREIGN_PROJECT_ID },
          name: `foreign-provider-${suffix}`,
          window: "month",
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
      expect(foreignBody.error.meta.scope_type).toBe("model provider");
    });

    /** @scenario REST budget spend is the live ClickHouse ledger, not the stale PG column */
    it("serves ledger spend for listed budgets", async () => {
      const vk = await createVk({ name: `ledger-vk-${suffix}` });
      const vkId = vk.body.virtual_key.id;
      const createRes = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "virtual_key", virtual_key_id: vkId },
          name: `ledger-budget-${suffix}`,
          window: "month",
          limit_usd: 100,
        },
        legacyAuth(),
      );
      const budgetId = (await createRes.json()).budget.id;

      const chRepo = GatewayBudgetLedgerAdapter.create(async () => ch());
      await chRepo.insertDebit([
        {
          tenantId: PROJECT_ID,
          budgetId,
          scope: "VIRTUAL_KEY",
          scopeId: vkId,
          window: "MONTH",
          virtualKeyId: vkId,
          gatewayRequestId: `req-gwrest-${suffix}`,
          amountNanoUsd: 1_250_000_000,
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

      const list = await app.request("/api/gateway/v1/budgets?scope_type=virtual_key", {
        headers: legacyAuth(),
      });
      const listBody = await list.json();
      const row = listBody.data.find((b: any) => b.id === budgetId);
      expect(row).toBeDefined();
      expect(row.spent_usd).toBe("1.25");
      // The display string and the integer beside it are one number.
      expect(row.spent_nano_usd).toBe(1_250_000_000);
    });

    /** @scenario Budget update and archive over REST */
    it("updates and archives a budget", async () => {
      const createRes = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "project", project_id: PROJECT_ID },
          name: `mutable-budget-${suffix}`,
          window: "month",
          limit_usd: 30,
        },
        legacyAuth(),
      );
      const id = (await createRes.json()).budget.id;

      const updateRes = await patch(
        `/api/gateway/v1/budgets/${id}`,
        { limit_usd: 45, on_breach: "warn" },
        legacyAuth(),
      );
      expect(updateRes.status).toBe(200);
      const updated = await updateRes.json();
      expect(updated.budget.limit_usd).toBe("45");
      expect(updated.budget.on_breach).toBe("warn");

      const deleteRes = await app.request(`/api/gateway/v1/budgets/${id}`, {
        method: "DELETE",
        headers: legacyAuth(),
      });
      expect(deleteRes.status).toBe(200);
      expect((await deleteRes.json()).budget.archived_at).not.toBeNull();
    });
  });

  // ── Pagination ────────────────────────────────────────────────────────

  describe("cursor pagination on the unbounded lists", () => {
    it("persists a cache-rule mutation with its configuration change event and audit trail", async () => {
      const body = {
        name: `audited-rule-${suffix}`,
        matchers: { model: "gpt-5-mini" },
        action: { mode: "force", ttl: 60 },
      };
      const eventsBefore = await prisma.gatewayChangeEvent.count({
        where: { organizationId: ORG_ID, kind: "CACHE_RULE_CREATED" },
      });
      const auditsBefore = await prisma.auditLog.count({
        where: { organizationId: ORG_ID, action: "gateway.cache_rule.created" },
      });

      const created = await post("/api/gateway/v1/cache-rules", body, legacyAuth());
      expect(created.status).toBe(201);
      const createdBody = await created.json();

      await expect(
        prisma.gatewayCacheRule.findUnique({ where: { id: createdBody.cache_rule.id } }),
      ).resolves.toMatchObject({ modeEnum: "FORCE", action: body.action });
      await expect(
        prisma.gatewayChangeEvent.count({
          where: { organizationId: ORG_ID, kind: "CACHE_RULE_CREATED" },
        }),
      ).resolves.toBe(eventsBefore + 1);
      await expect(
        prisma.auditLog.count({
          where: { organizationId: ORG_ID, action: "gateway.cache_rule.created" },
        }),
      ).resolves.toBe(auditsBefore + 1);

      const archived = await app.request(
        `/api/gateway/v1/cache-rules/${createdBody.cache_rule.id}`,
        { method: "DELETE", headers: legacyAuth() },
      );
      expect(archived.status).toBe(200);
      await expect(
        prisma.gatewayCacheRule.findUnique({ where: { id: createdBody.cache_rule.id } }),
      ).resolves.toMatchObject({ archivedAt: expect.any(Date) });
    });

    /** @scenario An unbounded list is walked by cursor without loss or repeats */
    it("pages budgets without skipping or repeating a row", async () => {
      for (let i = 0; i < 5; i++) {
        const res = await post(
          "/api/gateway/v1/budgets",
          {
            scope: { kind: "project", project_id: PROJECT_ID },
            name: `paged-${i}-${suffix}`,
            window: "month",
            limit_usd: 5,
          },
          legacyAuth(),
        );
        expect(res.status).toBe(201);
      }

      const oneShot = await app.request("/api/gateway/v1/budgets?limit=200", {
        headers: legacyAuth(),
      });
      const all = (await oneShot.json()).data.map((b: any) => b.id);
      expect(all.length).toBeGreaterThanOrEqual(5);

      // Two rows at a time must reconstruct the single-page list exactly.
      const walked = await walkAll("/api/gateway/v1/budgets", 2);
      expect(walked).toEqual(all);
      expect(new Set(walked).size).toBe(walked.length);
    });

    /** @scenario A filtered list pages on rows returned, not rows examined */
    it("applies the scope_type filter in the query, not to the page", async () => {
      const walked = await walkAll("/api/gateway/v1/budgets?scope_type=project", 2);
      expect(walked.length).toBeGreaterThan(0);
      expect(new Set(walked).size).toBe(walked.length);
    });

    /** @scenario Every unbounded list takes the same page controls */
    it("pages virtual keys and cache rules the same way", async () => {
      const created = await post(
        "/api/gateway/v1/cache-rules",
        {
          name: `paged-rule-${suffix}`,
          matchers: { model: "gpt-5-mini" },
          action: { mode: "force", ttl: 60 },
        },
        legacyAuth(),
      );
      expect(created.status).toBe(201);

      for (const path of ["/api/gateway/v1/virtual-keys", "/api/gateway/v1/cache-rules"]) {
        const walked = await walkAll(path, 2);
        expect(new Set(walked).size).toBe(walked.length);
        const oneShot = await app.request(`${path}?limit=200`, {
          headers: legacyAuth(),
        });
        const body = await oneShot.json();
        expect(body.next_cursor).toBeNull();
        expect(walked).toEqual(body.data.map((r: any) => r.id));
      }
    });

    /** @scenario A cursor this surface did not issue is refused */
    it("refuses a garbled cursor instead of restarting the walk", async () => {
      for (const path of [
        "/api/gateway/v1/budgets",
        "/api/gateway/v1/virtual-keys",
        "/api/gateway/v1/cache-rules",
      ]) {
        const res = await app.request(`${path}?cursor=not-a-real-cursor`, {
          headers: legacyAuth(),
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
          error: { type: "bad_request", code: "invalid_cursor" },
        });
      }
    });

    /** @scenario The page size is capped */
    it("refuses a limit above the cap", async () => {
      const res = await app.request("/api/gateway/v1/budgets?limit=500", {
        headers: legacyAuth(),
      });
      expect(res.status).toBe(400);
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
      // Epoch milliseconds, the unit every other spend endpoint speaks.
      expect(typeof body.window.from).toBe("number");
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

      const res = await app.request(`/api/gateway/v1/virtual-keys/${vkId}/spend`, {
        headers: legacyAuth(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      // Exact, not `toBeCloseTo`: the field is a display STRING, and a
      // tolerance-based assertion is what let float noise onto the wire
      // unnoticed in the first place.
      expect(body.spent_usd).toBe("1.25");
      expect(body.requests).toBe(2);
    });

    /** @scenario Per-key spend publishes a clean decimal string, whatever the sum drifted to */
    it("publishes a sub-cent total without the Float64 sum's drift", async () => {
      const vk = await createVk({ name: `dust-${suffix}` });
      const vkId = vk.body.virtual_key.id;
      // 24 x 0.000001875 is 0.000045 exactly, but the Float64 sum of it lands
      // one ULP low and stringifies as "0.000044999999999999996". Any other
      // summation order drifts differently, so the assertion is the amount.
      for (let i = 0; i < 24; i++) {
        await insertGatewayTrace({
          tenantId: PROJECT_ID,
          traceId: `trace-gwrest-dust-${i}-${suffix}`,
          virtualKeyId: vkId,
          occurredAt: new Date(Date.now() - 60_000),
          totalCost: 0.000001875,
        });
      }

      const res = await app.request(`/api/gateway/v1/virtual-keys/${vkId}/spend`, {
        headers: legacyAuth(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.spent_usd).toBe("0.000045");
      expect(body.requests).toBe(24);
    });

    /** @scenario The spend read validates its window */
    it("refuses an inverted window", async () => {
      const vk = await createVk({ name: `windowed-${suffix}` });
      const id = vk.body.virtual_key.id;
      const from = Date.UTC(2026, 1, 1);
      const to = Date.UTC(2026, 0, 1);
      const res = await app.request(
        `/api/gateway/v1/virtual-keys/${id}/spend?from=${from}&to=${to}`,
        { headers: legacyAuth() },
      );
      expect(res.status).toBe(400);
    });

    /** @scenario The spend window is epoch milliseconds, like every spend endpoint */
    it("takes epoch-ms and echoes a window it would accept back", async () => {
      const vk = await createVk({ name: `epoch-window-${suffix}` });
      const id = vk.body.virtual_key.id;
      const from = Date.UTC(2026, 6, 1);
      const to = Date.UTC(2026, 6, 15);
      const res = await app.request(
        `/api/gateway/v1/virtual-keys/${id}/spend?from=${from}&to=${to}`,
        { headers: legacyAuth() },
      );
      expect(res.status).toBe(200);
      expect((await res.json()).window).toEqual({ from, to });

      // The ISO strings this route used to take are no longer a window.
      const iso = await app.request(
        `/api/gateway/v1/virtual-keys/${id}/spend?from=2026-07-01T00:00:00Z`,
        { headers: legacyAuth() },
      );
      expect(iso.status).toBe(400);
    });

    /** @scenario Spend for an unknown key is a 404, not a zero */
    it("404s for an unknown key id", async () => {
      const res = await app.request(`/api/gateway/v1/virtual-keys/vk_does_not_exist/spend`, {
        headers: legacyAuth(),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("external_id and metadata", () => {
    /** @scenario A virtual key carries the caller's own id and bookkeeping */
    it("round-trips external_id and metadata on a virtual key", async () => {
      const externalId = `vk-ext-${suffix}`;
      const { status, body } = await createVk({
        name: `ext-vk-${suffix}`,
        external_id: externalId,
        metadata: { team: "platform", cost_center: "cc-42" },
      });
      expect(status).toBe(201);
      expect(body.virtual_key.external_id).toBe(externalId);
      expect(body.virtual_key.metadata).toEqual({
        team: "platform",
        cost_center: "cc-42",
      });

      // Both fields must survive every read shape, not just the create echo.
      const get = await app.request(`/api/gateway/v1/virtual-keys/${body.virtual_key.id}`, {
        headers: legacyAuth(),
      });
      const fetched = await get.json();
      expect(fetched.virtual_key.external_id).toBe(externalId);
      expect(fetched.virtual_key.metadata).toEqual({
        team: "platform",
        cost_center: "cc-42",
      });

      const list = await app.request(`/api/gateway/v1/virtual-keys?external_id=${externalId}`, {
        headers: legacyAuth(),
      });
      expect(list.status).toBe(200);
      const listed = await list.json();
      expect(listed.data).toHaveLength(1);
      expect(listed.data[0].id).toBe(body.virtual_key.id);
      expect(listed.data[0].metadata).toEqual({
        team: "platform",
        cost_center: "cc-42",
      });
    });

    /** @scenario A key with no external id reads as null, not as an empty string */
    it("defaults external_id to null and metadata to an empty map", async () => {
      const { body } = await createVk({ name: `ext-absent-${suffix}` });
      expect(body.virtual_key.external_id).toBeNull();
      expect(body.virtual_key.metadata).toEqual({});
    });

    /** @scenario Patching metadata replaces the stored map rather than merging */
    it("replaces metadata on patch and clears external_id with null", async () => {
      const { body } = await createVk({
        name: `ext-patch-${suffix}`,
        external_id: `vk-patch-${suffix}`,
        metadata: { keep: "no", drop: "yes" },
      });
      const id = body.virtual_key.id;

      const replaced = await patch(
        `/api/gateway/v1/virtual-keys/${id}`,
        { metadata: { keep: "yes" } },
        legacyAuth(),
      );
      expect(replaced.status).toBe(200);
      // A merge would have left `drop` behind; replacement is the contract.
      expect((await replaced.json()).virtual_key.metadata).toEqual({
        keep: "yes",
      });

      const cleared = await patch(
        `/api/gateway/v1/virtual-keys/${id}`,
        { external_id: null },
        legacyAuth(),
      );
      expect(cleared.status).toBe(200);
      expect((await cleared.json()).virtual_key.external_id).toBeNull();

      // Clearing must free the id for another key, which is only true if the
      // column went to SQL NULL rather than to an empty string.
      const reuse = await createVk({
        name: `ext-reuse-${suffix}`,
        external_id: `vk-patch-${suffix}`,
      });
      expect(reuse.status).toBe(201);
    });

    /** @scenario A second resource cannot claim an external id already in use */
    it("409s with external_id_conflict on a duplicate virtual key id", async () => {
      const externalId = `vk-dupe-${suffix}`;
      const first = await createVk({
        name: `ext-dupe-a-${suffix}`,
        external_id: externalId,
      });
      expect(first.status).toBe(201);

      const second = await createVk({
        name: `ext-dupe-b-${suffix}`,
        external_id: externalId,
      });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("external_id_conflict");
      expect(second.body.error.meta.resource).toBe("virtual_key");
      expect(second.body.error.meta.external_id).toBe(externalId);
    });

    /** @scenario A budget carries the caller's own id and bookkeeping */
    it("round-trips external_id and metadata on a budget, and conflicts", async () => {
      const externalId = `bg-ext-${suffix}`;
      const created = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "project", project_id: PROJECT_ID },
          name: `ext-budget-${suffix}`,
          window: "month",
          limit_usd: 5,
          external_id: externalId,
          metadata: { owner: "finance" },
        },
        legacyAuth(),
      );
      expect(created.status).toBe(201);
      const createdBody = await created.json();
      expect(createdBody.budget.external_id).toBe(externalId);
      expect(createdBody.budget.metadata).toEqual({ owner: "finance" });

      const byId = await app.request(`/api/gateway/v1/budgets/${createdBody.budget.id}`, {
        headers: legacyAuth(),
      });
      expect((await byId.json()).budget.external_id).toBe(externalId);

      const filtered = await app.request(`/api/gateway/v1/budgets?external_id=${externalId}`, {
        headers: legacyAuth(),
      });
      expect(filtered.status).toBe(200);
      const filteredBody = await filtered.json();
      expect(filteredBody.data).toHaveLength(1);
      expect(filteredBody.data[0].id).toBe(createdBody.budget.id);

      const duplicate = await post(
        "/api/gateway/v1/budgets",
        {
          scope: { kind: "project", project_id: PROJECT_ID },
          name: `ext-budget-dupe-${suffix}`,
          window: "month",
          limit_usd: 5,
          external_id: externalId,
        },
        legacyAuth(),
      );
      expect(duplicate.status).toBe(409);
      expect((await duplicate.json()).error.code).toBe("external_id_conflict");
    });

    /** @scenario Metadata beyond the documented caps is refused, naming the key */
    it("refuses metadata past the value and key-count caps", async () => {
      const tooLong = await createVk({
        name: `ext-cap-value-${suffix}`,
        metadata: { note: "x".repeat(501) },
      });
      expect(tooLong.status).toBe(400);
      expect(tooLong.body.error.code).toBe("validation_error");
      expect(tooLong.body.error.meta.fields).toContain("metadata.note");

      const tooMany = await createVk({
        name: `ext-cap-keys-${suffix}`,
        metadata: Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, "v"])),
      });
      expect(tooMany.status).toBe(400);
      expect(tooMany.body.error.code).toBe("validation_error");
    });

    /** @scenario Two keys may both carry no external id */
    it("lets any number of keys carry no external id", async () => {
      // The unique index is on (organizationId, externalId); if the column
      // defaulted to "" instead of NULL this would be the second collision.
      const a = await createVk({ name: `ext-null-a-${suffix}` });
      const b = await createVk({ name: `ext-null-b-${suffix}` });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
    });
  });

  // ── Idempotency-Key ───────────────────────────────────────────────────

  describe("when a create carries an Idempotency-Key", () => {
    /** A distinct budget body per test, so counting by name counts one test. */
    function budgetBody(label: string) {
      return {
        scope: { kind: "project", project_id: PROJECT_ID },
        name: `idem-${label}-${suffix}`,
        window: "month",
        limit_usd: 5,
      };
    }

    function keyed(key: string): Record<string, string> {
      return { ...legacyAuth(), "Idempotency-Key": key };
    }

    const budgetsNamed = (name: string) =>
      prisma.gatewayBudget.findMany({
        where: { organizationId: ORG_ID, name },
      });

    const receiptFor = (key: string) =>
      prisma.idempotencyReceipt.findUnique({
        where: { scopeId_key: { scopeId: PROJECT_ID, key } },
      });

    /**
     * Wait for a row a request in flight is about to write.
     *
     * The claim goes in before the handler runs, so a request parked inside
     * its handler has certainly written it; this only covers the moment
     * between starting that request and its insert landing.
     */
    async function pollFor<T>(read: () => Promise<T | null>): Promise<T> {
      for (let attempt = 0; attempt < 100; attempt++) {
        const found = await read();
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("the awaited row never appeared");
    }

    /** Re-encrypt under a key this deployment does not hold. */
    function encryptUnderAnotherKey(text: string): string {
      const key = crypto.randomBytes(32);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const body = cipher.update(text, "utf8", "hex") + cipher.final("hex");
      return `${iv.toString("hex")}:${body}:${cipher.getAuthTag().toString("hex")}`;
    }

    /** @scenario A create sent without an idempotency key is unchanged */
    it("writes no receipt when the header is absent", async () => {
      const body = budgetBody("keyless");
      const res = await post("/api/gateway/v1/budgets", body, legacyAuth());

      expect(res.status).toBe(201);
      expect(res.headers.get("X-Idempotent-Replay")).toBeNull();
      // The unkeyed path must not touch the table at all, so the whole scope
      // is checked rather than one key: a stray write would land under a key
      // this test does not know to look for.
      expect(
        await prisma.idempotencyReceipt.count({
          where: { scopeId: PROJECT_ID },
        }),
      ).toBe(0);
    });

    /** @scenario Retrying a create with the same key replays the first response */
    it("replays the stored response and creates nothing the second time", async () => {
      const key = `idem-replay-key-${suffix}`;
      const body = budgetBody("replay");

      const first = await post("/api/gateway/v1/budgets", body, keyed(key));
      expect(first.status).toBe(201);
      expect(first.headers.get("X-Idempotent-Replay")).toBeNull();
      const firstBody = await first.text();

      const receipt = await receiptFor(key);
      expect(receipt?.responseStatus).toBe(201);
      // At rest it is ciphertext, not the document. Asserted on the stored
      // column rather than through the helper, because the point is what an
      // operator reading this table would see.
      expect(receipt?.responseBody).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
      expect(receipt?.responseBody).not.toContain(body.name);

      const second = await post("/api/gateway/v1/budgets", body, keyed(key));
      expect(second.status).toBe(201);
      expect(second.headers.get("X-Idempotent-Replay")).toBe("true");
      // Byte-for-byte, not merely equivalent: the receipt stores the response's
      // serialised bytes, so a replay writes them through rather than
      // re-deriving them from a parsed document.
      expect(await second.text()).toBe(firstBody);
      expect(second.headers.get("Content-Type")).toBe(first.headers.get("Content-Type"));

      expect(await budgetsNamed(body.name)).toHaveLength(1);
    });

    /** @scenario A receipt that no longer decrypts lets the key be used again */
    it("treats a receipt written under a rotated secret as a fresh key", async () => {
      const key = `idem-rotated-key-${suffix}`;
      const body = budgetBody("rotated");

      expect((await post("/api/gateway/v1/budgets", body, keyed(key))).status).toBe(201);

      // What rotating CREDENTIALS_SECRET inside the receipt's 24 hours leaves
      // behind: an authentic row this process can no longer read.
      const stored = await receiptFor(key);
      await prisma.idempotencyReceipt.update({
        where: { id: stored!.id },
        data: { responseBody: encryptUnderAnotherKey(stored!.responseBody!) },
      });

      const again = await post("/api/gateway/v1/budgets", body, keyed(key));
      expect(again.status).toBe(201);
      expect(again.headers.get("X-Idempotent-Replay")).toBeNull();
      expect(await budgetsNamed(body.name)).toHaveLength(2);

      // Superseded rather than left to keep failing for the rest of its life.
      const replacement = await receiptFor(key);
      expect(replacement?.id).not.toBe(stored!.id);
    });

    /** @scenario Reusing a key with a different body is refused */
    it("refuses a second request whose body changed", async () => {
      const key = `idem-mismatch-key-${suffix}`;
      const body = budgetBody("mismatch");

      expect((await post("/api/gateway/v1/budgets", body, keyed(key))).status).toBe(201);

      const mutated = await post("/api/gateway/v1/budgets", { ...body, limit_usd: 6 }, keyed(key));
      const error = await expectCanonicalError(mutated, {
        status: 409,
        code: "idempotency_error",
      });
      expect(error.meta?.reason).toBe("body_mismatch");
      expect(await budgetsNamed(body.name)).toHaveLength(1);
    });

    /**
     * Wind a receipt back to the state its first request held between
     * claiming the key and storing its answer.
     *
     * Doctoring a real receipt rather than inserting one keeps the
     * fingerprint identical to the route's, which is taken over the VALIDATED
     * body and so cannot be recomputed here.
     */
    async function windBackToPending({
      key,
      claimedAt,
      lastBeatAt,
    }: {
      key: string;
      claimedAt: Date;
      lastBeatAt: Date;
    }) {
      const claimed = await receiptFor(key);
      await prisma.idempotencyReceipt.update({
        where: { id: claimed!.id },
        data: {
          responseStatus: null,
          responseBody: null,
          createdAt: claimedAt,
          heartbeatAt: lastBeatAt,
        },
      });
      return claimed!;
    }

    /** @scenario A retry sent while the original is still running is refused */
    it("refuses a retry against a receipt still marked pending", async () => {
      const key = `idem-pending-key-${suffix}`;
      const body = budgetBody("pending");

      expect((await post("/api/gateway/v1/budgets", body, keyed(key))).status).toBe(201);

      await windBackToPending({
        key,
        claimedAt: new Date(),
        lastBeatAt: new Date(),
      });

      const retry = await post("/api/gateway/v1/budgets", body, keyed(key));
      const error = await expectCanonicalError(retry, {
        status: 409,
        code: "idempotency_error",
      });
      expect(error.meta?.reason).toBe("in_progress");
      // Refused, not queued: nothing new was written.
      expect(await budgetsNamed(body.name)).toHaveLength(1);
    });

    /** @scenario "A slow original that is still reporting alive keeps its claim" */
    it("refuses a retry against a long-running claim that is still beating", async () => {
      const key = `idem-slow-key-${suffix}`;
      const body = budgetBody("slow");

      expect((await post("/api/gateway/v1/budgets", body, keyed(key))).status).toBe(201);

      // A request five minutes into its handler, waiting on a lock or a
      // saturated pool, that reported itself alive a moment ago. Any rule
      // reading the claim's age hands the key to this retry, which then
      // creates a second budget alongside the one the original is still going
      // to write. That is the exact failure this refusal exists to stop, and
      // it lands hardest when the platform is already struggling.
      await windBackToPending({
        key,
        claimedAt: new Date(Date.now() - 5 * 60_000),
        lastBeatAt: new Date(),
      });

      const retry = await post("/api/gateway/v1/budgets", body, keyed(key));
      const error = await expectCanonicalError(retry, {
        status: 409,
        code: "idempotency_error",
      });
      expect(error.meta?.reason).toBe("in_progress");
      expect(await budgetsNamed(body.name)).toHaveLength(1);
    });

    /** @scenario "A claim that stopped reporting itself alive is taken over" */
    it("takes over a claim that stopped beating and creates exactly one budget", async () => {
      const key = `idem-stale-key-${suffix}`;
      const body = budgetBody("stale");

      expect((await post("/api/gateway/v1/budgets", body, keyed(key))).status).toBe(201);

      // A process that died between claiming the key and writing anything:
      // the budget its create made is removed, so what is left is the pending
      // row alone, exactly as a crash in that window leaves it.
      const claimed = await windBackToPending({
        key,
        claimedAt: new Date(Date.now() - 5 * 60_000),
        lastBeatAt: new Date(Date.now() - 61_000),
      });
      await prisma.gatewayBudget.deleteMany({
        where: { organizationId: ORG_ID, name: body.name },
      });

      // Without the takeover this answers 409 for the next 24 hours, and the
      // caller can never complete the create it was trying to make.
      const retry = await post("/api/gateway/v1/budgets", body, keyed(key));
      expect(retry.status).toBe(201);
      expect(retry.headers.get("X-Idempotent-Replay")).toBeNull();

      const superseded = await receiptFor(key);
      expect(superseded?.responseStatus).toBe(201);
      // The same row under a new claim rather than a fresh row, which is what
      // lets the request that was replaced be told apart from the one that
      // replaced it.
      expect(superseded?.id).toBe(claimed.id);
      expect(superseded?.claimId).not.toBe(claimed.claimId);

      expect(await budgetsNamed(body.name)).toHaveLength(1);
    });

    /** @scenario "A replaced request cannot overwrite the receipt that replaced it" */
    it("fences the replaced request out of the receipt", async () => {
      const key = `idem-fenced-key-${suffix}`;
      const validatedBody = { name: `idem-fenced-${suffix}` };
      const operation = "gateway.v1.budgets.create";

      // The original: parked inside its handler, which is what a request slow
      // enough to be declared dead looks like from outside.
      let letOriginalFinish: () => void = () => undefined;
      const parked = new Promise<void>((resolve) => {
        letOriginalFinish = resolve;
      });
      const original = withIdempotency({
        prisma,
        operation,
        scopeId: PROJECT_ID,
        key,
        validatedBody,
        handler: async () => {
          await parked;
          return { status: 201, body: { id: "from-the-original" } };
        },
      });

      const claimed = await pollFor(() => receiptFor(key));
      // Silence it without stopping it, so the request is genuinely still
      // running when its claim is taken away.
      await prisma.idempotencyReceipt.update({
        where: { id: claimed.id },
        data: { heartbeatAt: new Date(Date.now() - 61_000) },
      });

      const replacement = await withIdempotency({
        prisma,
        operation,
        scopeId: PROJECT_ID,
        key,
        validatedBody,
        handler: () =>
          Promise.resolve({
            status: 201,
            body: { id: "from-the-replacement" },
          }),
      });
      expect(replacement.isReplayed).toBe(false);

      const takenOver = await receiptFor(key);
      expect(takenOver?.claimId).not.toBe(claimed.claimId);

      // The original comes back from the dead and stores its answer.
      letOriginalFinish();
      await original;

      const settled = await receiptFor(key);
      expect(settled?.claimId).toBe(takenOver?.claimId);
      // The key answers for the request that owns it, not for the one that was
      // replaced. Without the fence this row now replays a response whose
      // resource the replacement never made.
      expect(readStoredBody(settled!)).toBe(serializeResponseBody({ id: "from-the-replacement" }));

      await prisma.idempotencyReceipt.deleteMany({ where: { id: claimed.id } });
    });

    /** @scenario An expired receipt lets the key be used again */
    it("treats a lapsed key as a fresh one", async () => {
      const key = `idem-expired-key-${suffix}`;
      const body = budgetBody("expired");

      expect((await post("/api/gateway/v1/budgets", body, keyed(key))).status).toBe(201);

      const stored = await receiptFor(key);
      await prisma.idempotencyReceipt.update({
        where: { id: stored!.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const again = await post("/api/gateway/v1/budgets", body, keyed(key));
      expect(again.status).toBe(201);
      expect(again.headers.get("X-Idempotent-Replay")).toBeNull();
      expect(await budgetsNamed(body.name)).toHaveLength(2);

      // Collected on the way past, so the table does not keep a row nothing
      // will ever read again.
      const replacement = await receiptFor(key);
      expect(replacement?.id).not.toBe(stored!.id);
      expect(replacement?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    /** @scenario An unusable idempotency key is refused before anything is created */
    it("refuses a key that is too short", async () => {
      const body = budgetBody("shortkey");
      const res = await post("/api/gateway/v1/budgets", body, keyed("short"));

      const error = await expectCanonicalError(res, {
        status: 400,
        code: "validation_error",
      });
      expect(error.meta?.target).toBe("header");
      expect(await budgetsNamed(body.name)).toHaveLength(0);
    });

    /** @scenario The other keyed creates take the same header */
    it("replays a cache rule create too", async () => {
      const key = `idem-cache-key-${suffix}`;
      const body = {
        name: `idem-cache-${suffix}`,
        matchers: { model: "gpt-5-mini" },
        action: { mode: "respect", ttl: 60 },
      };

      const first = await post("/api/gateway/v1/cache-rules", body, keyed(key));
      expect(first.status).toBe(201);
      const firstBody = await first.text();

      const second = await post("/api/gateway/v1/cache-rules", body, keyed(key));
      expect(second.status).toBe(201);
      expect(second.headers.get("X-Idempotent-Replay")).toBe("true");
      expect(await second.text()).toBe(firstBody);

      expect(
        await prisma.gatewayCacheRule.findMany({
          where: { organizationId: ORG_ID, name: body.name },
        }),
      ).toHaveLength(1);
    });
  });
});
