/**
 * @vitest-environment node
 * Scope-aware RBAC for the VirtualKey write paths, over real Postgres.
 * Spec: specs/ai-gateway/governance/vk-scope-rbac.feature
 */
import type { AuthzService } from "@langwatch/authz-contract";
import {
  EventingAuthzCommandDispatcherAdapter,
  KsuidAuthzBindingIdAdapter,
  PostgresAuthzAdapter,
} from "@langwatch/authz-server";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import { VirtualKeyTrpcApi, type VirtualKeyTrpcContext } from "@langwatch/gateway-server";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
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

/** A collaborator these operations never reach; calling one is the test's bug. */
const unreachable = <Method>(): Method =>
  (() => Promise.reject(new Error("not reachable from a virtual-key write"))) as Method;

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

type Caller = ReturnType<ReturnType<typeof buildRouter>["createCaller"]>;

/** The real permission cascade, over the same rows the fixture seeds. */
function buildAuthz(): AuthzService {
  const bindingIds = KsuidAuthzBindingIdAdapter.create();
  return PostgresAuthzAdapter.create({
    database: prisma,
    // No epoch cache: a fixture that seeds bindings mid-suite must never read
    // a decision cached before the seed.
    redis: null,
    dispatcher: EventingAuthzCommandDispatcherAdapter.create(),
    newBindingId: () => bindingIds.newBindingId(),
    cacheEnabled: () => false,
  }).build().authz;
}

/** The gateway application this process composes, wired to real Postgres. */
function buildGateway() {
  const projects = PostgresProjectAdapter.create({
    database: prisma,
    credentials: ProjectCredentialsAdapter.create(),
    // Personal-workspace provisioning is the organization service's, and no
    // virtual-key write below reaches it.
    organizations: {
      ensurePersonalWorkspace: unreachable<OrganizationService["ensurePersonalWorkspace"]>(),
      tryFindPersonalWorkspace: unreachable<OrganizationService["tryFindPersonalWorkspace"]>(),
    } as unknown as OrganizationService,
  }).build() as ProjectService;

  return composeApiGateway({
    prisma,
    authz: buildAuthz(),
    projects,
    evaluators: {} as unknown as EvaluatorService,
    monitors: {} as unknown as MonitorService,
    clickhouse: null,
    virtualKeyPepper: "test-virtual-key-pepper",
  });
}

/**
 * The `virtualKeys.*` router on a bare root.
 */
function buildRouter(gateway: ReturnType<typeof buildGateway>) {
  const trpc = initTRPC.context<VirtualKeyTrpcContext>().create();
  return VirtualKeyTrpcApi.create(
    trpc,
    { protected: trpc.procedure, resolverAuthorizedPolicy: () => (procedure) => procedure },
    gateway.app.schemas,
  );
}

describe.skipIf(!databaseUrl)("virtualKeys — scope-aware RBAC (real Postgres)", () => {
  const ns = `vkrbac-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;
  const TEAM_PLATFORM = `team-platform-${ns}`;
  const TEAM_DATA_SCI = `team-datasci-${ns}`;
  const PROJECT_DEMO = `proj-demo-${ns}`;
  const PROJECT_ML_PROD = `proj-mlprod-${ns}`;
  const OWNER_ID = `usr-owner-${ns}`;

  let gateway: ReturnType<typeof buildGateway>;
  let router: ReturnType<typeof buildRouter>;
  let seq = 0;

  function callerFor(uid: string): Caller {
    return router.createCaller({
      app: { gateway: gateway.app },
      actor: () => ({ id: uid }),
      session: { user: { id: uid } },
    });
  }

  /**
   * Seed an org MEMBER whose only grant is a CUSTOM RoleBinding carrying
   * `permissions` at each of `scopes`. Returns a tRPC caller for them.
   */
  async function seedUser(
    perms: string[],
    scopes: { scopeType: RoleBindingScopeType; scopeId: string }[],
  ): Promise<Caller> {
    const uid = `usr-${ns}-${seq++}`;
    const email = `${uid}@example.com`;
    await prisma.user.create({ data: { id: uid, email, name: uid } });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_ID, userId: uid, role: OrganizationUserRole.MEMBER },
    });
    const roleId = `crole-${uid}`;
    await prisma.customRole.create({
      data: { id: roleId, organizationId: ORG_ID, name: roleId, permissions: perms },
    });
    for (const scope of scopes) {
      await prisma.roleBinding.create({
        data: {
          organizationId: ORG_ID,
          userId: uid,
          role: TeamUserRole.CUSTOM,
          customRoleId: roleId,
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
        },
      });
    }
    return callerFor(uid);
  }

  /**
   * Seed an org MEMBER whose visibility comes purely from membership rows,
   * with NO RoleBinding and NO virtualKeys:view grant. Proves list visibility
   * is membership-based, not permission-based.
   */
  async function seedTeamMember(teamIds: string[]): Promise<Caller> {
    const uid = `usr-mem-${ns}-${seq++}`;
    await prisma.user.create({ data: { id: uid, email: `${uid}@example.com`, name: uid } });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_ID, userId: uid, role: OrganizationUserRole.MEMBER },
    });
    for (const teamId of teamIds) {
      await prisma.teamUser.create({
        data: { userId: uid, teamId, role: TeamUserRole.MEMBER },
      });
    }
    return callerFor(uid);
  }

  /**
   * Seed an org ADMIN with NO TeamUser rows — the real-world shape of an org
   * owner, whose visibility must still cover project-scoped keys anywhere in
   * the organization.
   */
  async function seedOrgAdmin(): Promise<Caller> {
    const uid = `usr-admin-${ns}-${seq++}`;
    await prisma.user.create({ data: { id: uid, email: `${uid}@example.com`, name: uid } });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_ID, userId: uid, role: OrganizationUserRole.ADMIN },
    });
    return callerFor(uid);
  }

  async function seedVk(
    name: string,
    scopes: { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }[],
  ): Promise<string> {
    const id = `vk-${ns}-${name}`;
    await prisma.virtualKey.create({
      data: {
        id,
        organizationId: ORG_ID,
        name,
        hashedSecret: `hash-${id}`,
        displayPrefix: "vk-lw-SEED",
        createdById: OWNER_ID,
        config: {},
        scopes: { create: scopes },
      },
    });
    return id;
  }

  beforeAll(async () => {
    gateway = buildGateway();
    router = buildRouter(gateway);

    await prisma.organization.create({ data: { id: ORG_ID, name: ns, slug: ORG_ID } });
    await prisma.user.create({
      data: { id: OWNER_ID, email: `owner-${ns}@example.com`, name: OWNER_ID },
    });
    for (const [tid, slug] of [
      [TEAM_PLATFORM, `platform-${ns}`],
      [TEAM_DATA_SCI, `datasci-${ns}`],
    ] as const) {
      await prisma.team.create({
        data: { id: tid, name: tid, slug, organizationId: ORG_ID },
      });
    }
    for (const [pid, tid, slug] of [
      [PROJECT_DEMO, TEAM_PLATFORM, `demo-${ns}`],
      [PROJECT_ML_PROD, TEAM_DATA_SCI, `mlprod-${ns}`],
    ] as const) {
      await prisma.project.create({
        data: {
          id: pid,
          name: pid,
          slug,
          teamId: tid,
          language: "en",
          framework: "openai",
          apiKey: `key-${slug}`,
        },
      });
    }
    // The governance project every provisioned org has, so this fixture
    // matches the real shape. Creates above a project still name their own
    // destination, because an organization with projects to choose from is
    // refused for leaving it to the fallback. RBAC stays the only thing
    // under test here.
    await prisma.project.create({
      data: {
        id: `proj-gov-${ns}`,
        name: `gov-${ns}`,
        slug: `gov-${ns}`,
        teamId: TEAM_PLATFORM,
        language: "en",
        framework: "openai",
        apiKey: `key-gov-${ns}`,
        kind: "internal_governance",
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (!databaseUrl) return;
    await prisma.auditLog.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.customRole.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.teamUser.deleteMany({ where: { team: { organizationId: ORG_ID } } });
    await prisma.project.deleteMany({ where: { team: { organizationId: ORG_ID } } });
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { email: { contains: ns } } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  }, 60_000);

  const ORG = RoleBindingScopeType.ORGANIZATION;
  const TEAM = RoleBindingScopeType.TEAM;
  const PROJECT = RoleBindingScopeType.PROJECT;

  /** No key by that name reached the table, which is what a refusal means. */
  const noKeyNamed = async (name: string) =>
    expect(
      await prisma.virtualKey.findFirst({ where: { organizationId: ORG_ID, name } }),
    ).toBeNull();

  describe("given create authorizes virtualKeys:manage per requested scope", () => {
    /** @scenario Creating an ORG-scoped VK requires virtualKeys:manage at ORGANIZATION scope */
    it("allows an ORG-manage holder to create an ORG-scoped VK", async () => {
      const alice = await seedUser(["virtualKeys:manage"], [{ scopeType: ORG, scopeId: ORG_ID }]);
      const res = await alice.create({
        organizationId: ORG_ID,
        name: "alice-org",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        traceProjectId: PROJECT_DEMO,
      });
      expect(res.virtualKey.scopes).toEqual([
        expect.objectContaining({ scopeType: "ORGANIZATION", scopeId: ORG_ID }),
      ]);
    });

    /** @scenario Creating an ORG-scoped VK without org:manage on virtualKeys is rejected */
    it("rejects an ORG-scoped create from a team-only manage holder", async () => {
      const bob = await seedUser(
        ["virtualKeys:manage"],
        [{ scopeType: TEAM, scopeId: TEAM_PLATFORM }],
      );
      await expect(
        bob.create({
          organizationId: ORG_ID,
          name: "bob-org",
          scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await noKeyNamed("bob-org");
    });

    /** @scenario Creating a TEAM-scoped VK requires virtualKeys:manage at that team */
    it("allows a team-manage holder to create a TEAM-scoped VK", async () => {
      const carol = await seedUser(
        ["virtualKeys:manage"],
        [{ scopeType: TEAM, scopeId: TEAM_PLATFORM }],
      );
      const res = await carol.create({
        organizationId: ORG_ID,
        name: "carol-team",
        scopes: [{ scopeType: "TEAM", scopeId: TEAM_PLATFORM }],
        traceProjectId: PROJECT_DEMO,
      });
      expect(res.virtualKey.id).toBeTruthy();
    });

    /** @scenario User with TEAM "platform" perm cannot create a VK in TEAM "data-sci" */
    it("rejects creating a VK in a team the caller does not manage", async () => {
      const carol = await seedUser(
        ["virtualKeys:manage"],
        [{ scopeType: TEAM, scopeId: TEAM_PLATFORM }],
      );
      await expect(
        carol.create({
          organizationId: ORG_ID,
          name: "carol-cross",
          scopes: [{ scopeType: "TEAM", scopeId: TEAM_DATA_SCI }],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await noKeyNamed("carol-cross");
    });

    /** @scenario Creating a PROJECT-scoped VK requires virtualKeys:manage at that project (or upward) */
    it("allows a project-manage holder to create a PROJECT-scoped VK", async () => {
      const dave = await seedUser(
        ["virtualKeys:manage"],
        [{ scopeType: PROJECT, scopeId: PROJECT_DEMO }],
      );
      const res = await dave.create({
        organizationId: ORG_ID,
        name: "dave-proj",
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_DEMO }],
      });
      expect(res.virtualKey.id).toBeTruthy();
    });
  });

  describe("given the upward cascade (broader grant covers narrower scopes)", () => {
    /** @scenario virtualKeys:manage at ORGANIZATION scope allows creating VKs at any narrower scope */
    it("lets an ORG-manage holder create at team, project, and org scopes", async () => {
      const eve = await seedUser(["virtualKeys:manage"], [{ scopeType: ORG, scopeId: ORG_ID }]);
      for (const scope of [
        { scopeType: "TEAM" as const, scopeId: TEAM_PLATFORM },
        { scopeType: "PROJECT" as const, scopeId: PROJECT_DEMO },
        { scopeType: "ORGANIZATION" as const, scopeId: ORG_ID },
      ]) {
        const res = await eve.create({
          organizationId: ORG_ID,
          name: `eve-${scope.scopeType}`,
          scopes: [scope],
          traceProjectId: PROJECT_DEMO,
        });
        expect(res.virtualKey.id).toBeTruthy();
      }
    });

    /** @scenario virtualKeys:manage at TEAM scope allows creating VKs at projects within that team */
    it("lets a team-manage holder create at projects within the team but not outside", async () => {
      const frank = await seedUser(
        ["virtualKeys:manage"],
        [{ scopeType: TEAM, scopeId: TEAM_PLATFORM }],
      );
      const ok = await frank.create({
        organizationId: ORG_ID,
        name: "frank-in-team",
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_DEMO }],
      });
      expect(ok.virtualKey.id).toBeTruthy();
      await expect(
        frank.create({
          organizationId: ORG_ID,
          name: "frank-out-team",
          scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ML_PROD }],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await noKeyNamed("frank-out-team");
    });
  });

  describe("given a multi-scope create needs manage on every scope", () => {
    /** @scenario Creating a VK with multiple scopes requires manage on EACH scope (intersection of grants) */
    it("rejects when the caller manages only one of the requested scopes", async () => {
      const grace = await seedUser(
        ["virtualKeys:manage"],
        [{ scopeType: TEAM, scopeId: TEAM_PLATFORM }],
      );
      await expect(
        grace.create({
          organizationId: ORG_ID,
          name: "grace-multi",
          scopes: [
            { scopeType: "TEAM", scopeId: TEAM_PLATFORM },
            { scopeType: "TEAM", scopeId: TEAM_DATA_SCI },
          ],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await noKeyNamed("grace-multi");
    });

    /** @scenario User with manage at both teams can create the cross-team VK */
    it("allows the cross-team create when the caller manages both teams", async () => {
      const henry = await seedUser(
        ["virtualKeys:manage"],
        [
          { scopeType: TEAM, scopeId: TEAM_PLATFORM },
          { scopeType: TEAM, scopeId: TEAM_DATA_SCI },
        ],
      );
      const res = await henry.create({
        organizationId: ORG_ID,
        name: "henry-multi",
        scopes: [
          { scopeType: "TEAM", scopeId: TEAM_PLATFORM },
          { scopeType: "TEAM", scopeId: TEAM_DATA_SCI },
        ],
        traceProjectId: PROJECT_DEMO,
      });
      expect(res.virtualKey.scopes).toHaveLength(2);
    });
  });

  describe("given organizationId must own every requested scope", () => {
    /** @scenario A create cannot bind a scope from a different org than its organizationId */
    it("rejects a create whose organizationId differs from a team scope's org", async () => {
      // The caller legitimately manages TEAM_PLATFORM in ORG_ID, so the
      // per-scope manage gate passes — only the org-ownership check stops
      // the cross-org write.
      const caller = await seedUser(
        ["virtualKeys:manage"],
        [{ scopeType: TEAM, scopeId: TEAM_PLATFORM }],
      );
      await expect(
        caller.create({
          organizationId: `org-foreign-${ns}`,
          name: "cross-org-create",
          scopes: [{ scopeType: "TEAM", scopeId: TEAM_PLATFORM }],
        }),
      ).rejects.toMatchObject({ cause: { code: "gateway_scope_org_mismatch" } });
    });

    /** @scenario An ORGANIZATION scope must equal the organizationId */
    it("rejects a create whose ORGANIZATION scope differs from organizationId", async () => {
      const caller = await seedUser(["virtualKeys:manage"], [{ scopeType: ORG, scopeId: ORG_ID }]);
      await expect(
        caller.create({
          organizationId: `org-foreign-${ns}`,
          name: "cross-org-orgscope",
          scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
        }),
      ).rejects.toMatchObject({ cause: { code: "gateway_scope_org_mismatch" } });
    });
  });

  describe("given update / rotate / delete authorize the op-perm on one existing scope", () => {
    /** @scenario Updating a VK requires virtualKeys:update at one of the VK's scopes */
    it("allows an update-holder on the VK's project to rename it", async () => {
      const vkId = await seedVk("update-target", [{ scopeType: "PROJECT", scopeId: PROJECT_DEMO }]);
      const ian = await seedUser(
        ["virtualKeys:update"],
        [{ scopeType: PROJECT, scopeId: PROJECT_DEMO }],
      );
      const res = await ian.update({ organizationId: ORG_ID, id: vkId, name: "renamed" });
      expect(res.name).toBe("renamed");
    });

    /** @scenario Rotating a VK requires virtualKeys:rotate */
    it("allows a rotate-holder on the VK's team to rotate it", async () => {
      const vkId = await seedVk("rotate-target", [{ scopeType: "TEAM", scopeId: TEAM_PLATFORM }]);
      const jane = await seedUser(
        ["virtualKeys:rotate"],
        [{ scopeType: TEAM, scopeId: TEAM_PLATFORM }],
      );
      const before = await prisma.virtualKey.findUniqueOrThrow({ where: { id: vkId } });
      const res = await jane.rotate({ organizationId: ORG_ID, id: vkId });
      expect(res.secret).toBeTruthy();
      const after = await prisma.virtualKey.findUniqueOrThrow({ where: { id: vkId } });
      expect(after.revision).toBeGreaterThan(before.revision);
    });

    /** @scenario Deleting a VK requires virtualKeys:delete at one of the VK's scopes */
    it("rejects a delete from a view-only holder", async () => {
      const vkId = await seedVk("delete-target", [{ scopeType: "TEAM", scopeId: TEAM_PLATFORM }]);
      const karen = await seedUser(
        ["virtualKeys:view"],
        [{ scopeType: TEAM, scopeId: TEAM_PLATFORM }],
      );
      await expect(karen.revoke({ organizationId: ORG_ID, id: vkId })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      const still = await prisma.virtualKey.findUniqueOrThrow({ where: { id: vkId } });
      expect(still.status).toBe("ACTIVE");
    });
  });

  describe("given list visibility intersects the caller's membership set", () => {
    /** @scenario A user sees VKs whose scopes intersect their membership set */
    it("includes org + own-team VKs and excludes a sibling team's VK", async () => {
      const vkOrg = await seedVk("list-org", [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }]);
      const vkPlatform = await seedVk("list-platform", [
        { scopeType: "TEAM", scopeId: TEAM_PLATFORM },
      ]);
      const vkDataSci = await seedVk("list-datasci", [
        { scopeType: "TEAM", scopeId: TEAM_DATA_SCI },
      ]);
      const olive = await seedTeamMember([TEAM_PLATFORM]);
      const ids = (await olive.list({ organizationId: ORG_ID })).map((vk) => vk.id);
      expect(ids).toContain(vkOrg);
      expect(ids).toContain(vkPlatform);
      expect(ids).not.toContain(vkDataSci);
    });

    it("returns NOT_FOUND on get for a key outside the caller's membership", async () => {
      const vkDataSci = await seedVk("get-datasci", [
        { scopeType: "TEAM", scopeId: TEAM_DATA_SCI },
      ]);
      const olive = await seedTeamMember([TEAM_PLATFORM]);
      await expect(olive.get({ organizationId: ORG_ID, id: vkDataSci })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    /** @scenario An org ADMIN with no TeamUser rows sees project-scoped VKs (e.g. the auto-managed Langy VK) anywhere in the org */
    it("shows an org admin every project-scoped VK in the org despite zero team membership", async () => {
      const vkDemo = await seedVk("list-admin-demo", [
        { scopeType: "PROJECT", scopeId: PROJECT_DEMO },
      ]);
      const vkMlProd = await seedVk("list-admin-mlprod", [
        { scopeType: "PROJECT", scopeId: PROJECT_ML_PROD },
      ]);
      const admin = await seedOrgAdmin();
      const ids = (await admin.list({ organizationId: ORG_ID })).map((vk) => vk.id);
      expect(ids).toContain(vkDemo);
      expect(ids).toContain(vkMlProd);
    });

    /** @scenario A plain MEMBER still does NOT see a sibling-team project VK — the admin short-circuit must not leak to members */
    it("still hides a sibling-team project VK from a non-admin member", async () => {
      const vkMlProd = await seedVk("list-member-mlprod", [
        { scopeType: "PROJECT", scopeId: PROJECT_ML_PROD },
      ]);
      const olive = await seedTeamMember([TEAM_PLATFORM]);
      const ids = (await olive.list({ organizationId: ORG_ID })).map((vk) => vk.id);
      expect(ids).not.toContain(vkMlProd);
    });
  });

  describe("given the no-short-circuit invariant", () => {
    /** @scenario New VK routes work for a non-ADMIN user with explicit perm grants */
    it("lets a MEMBER with only a project-scoped manage grant create a VK", async () => {
      const noShortcut = await seedUser(
        ["virtualKeys:manage"],
        [{ scopeType: PROJECT, scopeId: PROJECT_DEMO }],
      );
      const res = await noShortcut.create({
        organizationId: ORG_ID,
        name: "no-shortcut",
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_DEMO }],
      });
      expect(res.virtualKey.id).toBeTruthy();
    });
  });
});
