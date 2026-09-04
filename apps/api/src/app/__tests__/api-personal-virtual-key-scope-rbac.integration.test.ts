/**
 * @vitest-environment node
 *
 * Scope-aware RBAC for the personal-VK path, over real Postgres.
 *
 * Ported from the retired application's
 * `server/api/routers/__tests__/personalVirtualKeys.scopeRbac.integration.test.ts`.
 * The router and the application are the Governance feature's now, but the
 * decision they turn on — may this caller see somebody else's personal keys —
 * is answered by this process's own `AuthzService`, so this is where the real
 * router, the real personal-key service and the real permission engine meet.
 * Nothing below stubs a permission: the ADMIN and MEMBER answers come from the
 * role templates the engine reads.
 *
 * Contract (specs/ai-gateway/governance/vk-scope-rbac.feature, personal-VK
 * block):
 *   - Any org member can lazy-mint + list their OWN personal keys with no
 *     explicit grant (principal-user match bypasses virtualKeys:view).
 *   - Viewing ANOTHER user's personal keys requires
 *     virtualKeys:viewOtherPersonal; org admins gain it via the ADMIN role
 *     template at runtime (no per-org backfill), plain members never do.
 */
import type { AuthzService } from "@langwatch/authz-contract";
import {
  EventingAuthzCommandDispatcherAdapter,
  KsuidAuthzBindingIdAdapter,
  PostgresAuthzAdapter,
} from "@langwatch/authz-server";
import {
  AppPersonalVirtualKeyIssuerPort,
  type GovernanceVirtualKeyPort,
} from "@langwatch/enterprise-api";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import {
  GovernanceApp,
  PersonalVirtualKeyTrpcApi,
  type PersonalVirtualKeyTrpcContext,
} from "@langwatch/enterprise-governance-server";
import {
  PostgresPersonalVirtualKeyAdapter,
  PostgresRoutingPolicyAdapter,
} from "@langwatch/enterprise-governance-server/testing";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import {
  GroupIdentityAdapter,
  OrganizationSettingsSecretPort,
  PersonalWorkspaceIdentityAdapter,
  PostgresOrganizationAdapter,
  TeamIdentityAdapter,
} from "@langwatch/organization-server";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
  type PrismaClient,
} from "@langwatch/prisma-client/generated";
import { PostgresProjectAdapter, ProjectCredentialsAdapter } from "@langwatch/project-server";
import type { ProjectService } from "@langwatch/project-contract";
import { initTRPC } from "@trpc/server";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeApiGateway } from "../api-gateway.composition";

/** The tenancy middleware fences production reads; a fixture seeds across it. */
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

/** Organization settings ciphertext, which no personal-key operation reads. */
class UnreadSettingsSecrets extends OrganizationSettingsSecretPort {
  encrypt(): string {
    throw new Error("organization settings are not read from a personal-key operation");
  }

  decrypt(): string {
    throw new Error("organization settings are not read from a personal-key operation");
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

const GATEWAY_BASE_URL = "https://gateway.test";

/**
 * The personal-key half of the Governance capability, and a refusal for every
 * other. `GovernanceService` is one object over fifteen surfaces; a suite that
 * reaches a second one from a personal-key call has found a bug, and says so.
 */
function governanceServiceFor(personalKeys: {
  list: GovernanceService["personalVirtualKeyList"];
  issue: GovernanceService["personalVirtualKeyIssue"];
}): GovernanceService {
  return new Proxy({} as GovernanceService, {
    get(_target, property) {
      if (property === "personalVirtualKeyList") return personalKeys.list;
      if (property === "personalVirtualKeyIssue") return personalKeys.issue;
      return () => {
        throw new Error(`governance.${String(property)} is not reachable from a personal key`);
      };
    },
    has: () => true,
  });
}

/** The governance application this process would compose, over real Postgres. */
function buildGovernanceApp(): GovernanceApp {
  const bindingIds = KsuidAuthzBindingIdAdapter.create();
  const authz = PostgresAuthzAdapter.create({
    database: prisma,
    // No epoch cache: a fixture that seeds bindings mid-suite must never read
    // a decision cached before the seed.
    redis: null,
    dispatcher: EventingAuthzCommandDispatcherAdapter.create(),
    newBindingId: () => bindingIds.newBindingId(),
    cacheEnabled: () => false,
  }).build();

  const organizations = PostgresOrganizationAdapter.create({
    database: prisma,
    identities: PersonalWorkspaceIdentityAdapter.create(),
    teamIdentities: TeamIdentityAdapter.create(),
    groupIdentities: GroupIdentityAdapter.create(),
    authz: authz.authz,
    grants: authz.grants,
    settingsSecrets: new UnreadSettingsSecrets(),
  }).build();

  const projects = PostgresProjectAdapter.create({
    database: prisma,
    credentials: ProjectCredentialsAdapter.create(),
    organizations,
  }).build() as ProjectService;

  const gateway = composeApiGateway({
    prisma,
    authz: authz.authz,
    projects,
    evaluators: {} as unknown as EvaluatorService,
    monitors: {} as unknown as MonitorService,
    clickhouse: null,
    virtualKeyPepper: "test-virtual-key-pepper",
  });

  const personalKeys = PostgresPersonalVirtualKeyAdapter.create({
    database: prisma,
    // The gateway's own write service is what mints the key; the issuer is the
    // process's mapping between the two shapes, taken rather than restated.
    issuer: AppPersonalVirtualKeyIssuerPort.create(
      gateway.virtualKeys as unknown as GovernanceVirtualKeyPort,
    ),
    organizations,
    policies: PostgresRoutingPolicyAdapter.create({ database: prisma }).build(),
    gatewayBaseUrl: GATEWAY_BASE_URL,
  }).build();

  return GovernanceApp.create({
    governance: governanceServiceFor({
      list: (query) => personalKeys.list(query),
      issue: (input) => personalKeys.issue(input),
    }),
    projects,
    organizations,
    // The real engine, so the ADMIN and MEMBER answers below come from the
    // role templates rather than from this file.
    permissions: authz.authz as AuthzService,
    personalVirtualKeys: {
      isOrganizationMember: async ({ organizationId, userId }) =>
        (await prisma.organizationUser.findFirst({
          where: { organizationId, userId },
          select: { userId: true },
        })) !== null,
      hasActivePersonalKeyLabelled: async ({ organizationId, userId, label }) =>
        (await prisma.virtualKey.findFirst({
          where: {
            organizationId,
            principalUserId: userId,
            name: label,
            status: { not: "REVOKED" },
          },
          select: { id: true },
        })) !== null,
    },
    actors: {
      tryFindUser: () => {
        throw new Error("actor drill-in is not reachable from a personal-key call");
      },
    },
  });
}

/**
 * The `personalVirtualKeys.*` router on a bare root. The process's policy chain
 * is tracing, logging and audit; it declares the permission but does not decide
 * it, so an identity decorator leaves the application's own decision standing.
 */
function buildRouter() {
  const trpc = initTRPC.context<PersonalVirtualKeyTrpcContext>().create();
  return PersonalVirtualKeyTrpcApi.create(trpc, {
    protected: trpc.procedure,
    policy: () => (procedure) => procedure,
    resolverAuthorizedPolicy: () => (procedure) => procedure,
  });
}

describe.skipIf(!databaseUrl)("personalVirtualKeys — scope-aware RBAC (real Postgres)", () => {
  const ns = `pvkrbac-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;
  const TEAM_ID = `team-${ns}`;
  const PROJECT_ID = `proj-${ns}`;
  const MODEL_PROVIDER_ID = `mp-${ns}`;
  const ROUTING_POLICY_ID = `rp-${ns}`;

  const LEO = `usr-leo-${ns}`;
  const MAYA = `usr-maya-${ns}`;
  const SWEEPER = `usr-sweeper-${ns}`;
  const ORG_ADMIN = `usr-admin-${ns}`;
  const PLAIN = `usr-plain-${ns}`;

  let governanceApp: GovernanceApp;
  let router: ReturnType<typeof buildRouter>;

  function callerFor(userId: string) {
    return router.createCaller({
      app: { governanceApp },
      actor: () => ({ id: userId }),
      session: { user: { id: userId, name: userId, email: `${userId}@example.com` } },
    });
  }

  async function seedCustomRole(userId: string, perms: string[]) {
    const roleId = `crole-${userId}`;
    await prisma.customRole.create({
      data: { id: roleId, organizationId: ORG_ID, name: roleId, permissions: perms },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG_ID,
        userId,
        role: TeamUserRole.CUSTOM,
        customRoleId: roleId,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      },
    });
  }

  async function seedPersonalVk(principalUserId: string, name: string): Promise<string> {
    const vk = await prisma.virtualKey.create({
      data: {
        organizationId: ORG_ID,
        name,
        description: "Personal virtual key",
        hashedSecret: `hash-${name}-${ns}`,
        displayPrefix: "vk-lw-SEED",
        principalUserId,
        createdById: principalUserId,
        config: {},
        scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
      },
    });
    return vk.id;
  }

  let leoVk: string;
  let mayaVk: string;

  beforeAll(async () => {
    governanceApp = buildGovernanceApp();
    router = buildRouter();

    await prisma.organization.create({ data: { id: ORG_ID, name: ns, slug: ORG_ID } });
    await prisma.user.createMany({
      data: [LEO, MAYA, SWEEPER, ORG_ADMIN, PLAIN].map((id) => ({
        id,
        email: `${id}@example.com`,
        name: id,
      })),
    });
    await prisma.organizationUser.createMany({
      data: [
        { organizationId: ORG_ID, userId: LEO, role: OrganizationUserRole.MEMBER },
        { organizationId: ORG_ID, userId: MAYA, role: OrganizationUserRole.MEMBER },
        { organizationId: ORG_ID, userId: SWEEPER, role: OrganizationUserRole.MEMBER },
        { organizationId: ORG_ID, userId: ORG_ADMIN, role: OrganizationUserRole.ADMIN },
        { organizationId: ORG_ID, userId: PLAIN, role: OrganizationUserRole.MEMBER },
      ],
    });
    await prisma.team.create({
      data: { id: TEAM_ID, name: TEAM_ID, slug: `team-${ns}`, organizationId: ORG_ID },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: PROJECT_ID,
        slug: `proj-${ns}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `key-${ns}`,
      },
    });

    // maya: virtualKeys:view but NOT viewOtherPersonal.
    await seedCustomRole(MAYA, ["virtualKeys:view"]);
    // sweeper: explicit viewOtherPersonal via a custom role.
    await seedCustomRole(SWEEPER, ["virtualKeys:viewOtherPersonal"]);
    // org admin: an ORGANIZATION-scoped ADMIN RoleBinding, no explicit
    // viewOtherPersonal perm — proving the ADMIN template grants it at
    // runtime (the migration contract).
    await prisma.roleBinding.create({
      data: {
        organizationId: ORG_ID,
        userId: ORG_ADMIN,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: ORG_ID,
      },
    });

    // Default routing policy + provider so issuePersonal can mint.
    await prisma.modelProvider.create({
      data: {
        id: MODEL_PROVIDER_ID,
        name: MODEL_PROVIDER_ID,
        provider: "openai",
        enabled: true,
        organizationId: ORG_ID,
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
      },
    });
    await prisma.routingPolicy.create({
      data: {
        id: ROUTING_POLICY_ID,
        organizationId: ORG_ID,
        name: ROUTING_POLICY_ID,
        isDefault: true,
        modelProviderIds: [MODEL_PROVIDER_ID],
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
      },
    });

    leoVk = await seedPersonalVk(LEO, "leo-default");
    mayaVk = await seedPersonalVk(MAYA, "maya-default");
  }, 60_000);

  afterAll(async () => {
    if (!databaseUrl) return;
    await prisma.auditLog.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.routingPolicy.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.modelProviderScope.deleteMany({
      where: { modelProviderId: MODEL_PROVIDER_ID },
    });
    await prisma.modelProvider.deleteMany({ where: { id: MODEL_PROVIDER_ID } });
    await prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.customRole.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.teamUser.deleteMany({ where: { team: { organizationId: ORG_ID } } });
    await prisma.project.deleteMany({ where: { team: { organizationId: ORG_ID } } });
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { email: { contains: ns } } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  }, 60_000);

  describe("given any member minting their own personal key", () => {
    /** @scenario Any authenticated user can lazy-mint their own personal VK via CLI device-flow */
    it("mints a personal VK owned by the caller with no explicit grant", async () => {
      const issued = await callerFor(LEO).issuePersonal({
        organizationId: ORG_ID,
        label: "leo-laptop",
      });
      expect(issued.secret).toBeTruthy();
      const minted = await prisma.virtualKey.findUniqueOrThrow({ where: { id: issued.id } });
      expect(minted.principalUserId).toBe(LEO);
    });
  });

  describe("given the caller lists their own personal keys", () => {
    /** @scenario A user can view their own personal VK without any explicit grant */
    it("returns the caller's own keys and not another user's", async () => {
      const ids = (await callerFor(LEO).list({ organizationId: ORG_ID })).map((k) => k.id);
      expect(ids).toContain(leoVk);
      expect(ids).not.toContain(mayaVk);
    });
  });

  describe("given the caller targets another user's personal keys", () => {
    /** @scenario A user cannot view another user's personal VK without virtualKeys:viewOtherPersonal */
    it("rejects a virtualKeys:view-only holder naming the missing perm", async () => {
      await expect(
        callerFor(MAYA).list({ organizationId: ORG_ID, targetUserId: LEO }),
      ).rejects.toMatchObject({
        cause: {
          code: "permission_denied",
          meta: { permission: "virtualKeys:viewOtherPersonal" },
        },
      });
    });

    /** @scenario Org member roles do NOT gain virtualKeys:viewOtherPersonal */
    it("rejects a plain org member with no grants", async () => {
      await expect(
        callerFor(PLAIN).list({ organizationId: ORG_ID, targetUserId: LEO }),
      ).rejects.toMatchObject({ cause: { code: "permission_denied" } });
    });
  });

  describe("given an auditor with viewOtherPersonal", () => {
    /** @scenario Org admin with viewOtherPersonal can audit other users' personal VKs (offboarding sweep) */
    it("returns every member's personal keys when no target is given", async () => {
      const ids = (await callerFor(SWEEPER).list({ organizationId: ORG_ID })).map((k) => k.id);
      expect(ids).toContain(leoVk);
      expect(ids).toContain(mayaVk);
    });

    /** @scenario Existing org admins automatically gain virtualKeys:viewOtherPersonal on migrate */
    it("lets an ADMIN-template holder read another user's keys without an explicit perm binding", async () => {
      const ids = (
        await callerFor(ORG_ADMIN).list({ organizationId: ORG_ID, targetUserId: LEO })
      ).map((k) => k.id);
      expect(ids).toContain(leoVk);
      expect(ids).not.toContain(mayaVk);
    });
  });
});
