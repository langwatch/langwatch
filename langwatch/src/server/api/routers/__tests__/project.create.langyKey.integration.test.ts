/**
 * @vitest-environment node
 *
 * Integration tests for dedicated Langy API key provisioning.
 * Real database — mocks only the planProvider / usageLimits system boundary
 * (so project.create runs without a real subscription).
 *
 * Spec: specs/assistant/langy-api-key-provisioning.feature
 * Requires: PostgreSQL database (Prisma)
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import {
  LANGY_API_KEY_NAME,
  provisionLangyApiKey,
} from "~/server/services/langy/langyApiKey";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

describe.skipIf(isTestcontainersOnly)("Langy API key provisioning", () => {
  const testNamespace = `langy-key-${nanoid(8)}`;
  let organizationId: string;
  let teamId: string;
  let userId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Langy Key Org", slug: `--test-org-${testNamespace}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: {
        name: "Langy Key Team",
        slug: `--test-team-${testNamespace}`,
        organizationId,
      },
    });
    teamId = team.id;

    const user = await prisma.user.create({
      data: { name: "Langy Key User", email: `${testNamespace}@example.com` },
    });
    userId = user.id;

    await prisma.organizationUser.create({
      data: { userId, organizationId, role: OrganizationUserRole.ADMIN },
    });
    await prisma.teamUser.create({
      data: { userId, teamId, role: TeamUserRole.ADMIN },
    });
  });

  beforeEach(async () => {
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: vi.fn().mockResolvedValue({
          ...FREE_PLAN,
          maxProjects: 50,
          overrideAddingLimitations: true,
        }) as PlanProvider["getActivePlan"],
      }),
      usageLimits: {
        notifyResourceLimitReached: vi.fn().mockResolvedValue(undefined),
        checkAndSendWarning: vi.fn().mockResolvedValue(undefined),
      } as any,
    });
  });

  afterEach(() => resetApp());

  afterAll(async () => {
    // RoleBindings + ApiKeys are org-scoped; delete them before the org.
    await prisma.roleBinding
      .deleteMany({ where: { organizationId } })
      .catch(() => {});
    await prisma.apiKey
      .deleteMany({ where: { organizationId } })
      .catch(() => {});
    await prisma.project.deleteMany({ where: { teamId } }).catch(() => {});
    await prisma.teamUser.deleteMany({ where: { teamId } }).catch(() => {});
    await prisma.team.deleteMany({ where: { id: teamId } }).catch(() => {});
    await prisma.organizationUser
      .deleteMany({ where: { organizationId } })
      .catch(() => {});
    await prisma.organization
      .deleteMany({ where: { id: organizationId } })
      .catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
  });

  function createCaller() {
    const ctx = createInnerTRPCContext({
      session: { user: { id: userId }, expires: "1" },
    });
    return appRouter.createCaller(ctx);
  }

  async function findLangyKeys(projectId: string) {
    return prisma.apiKey.findMany({
      where: {
        name: LANGY_API_KEY_NAME,
        revokedAt: null,
        roleBindings: {
          some: {
            scopeType: RoleBindingScopeType.PROJECT,
            scopeId: projectId,
          },
        },
      },
      include: { roleBindings: true },
    });
  }

  async function createProjectViaApi(name: string) {
    const caller = createCaller();
    const result = await caller.project.create({
      organizationId,
      teamId,
      name,
      language: "en",
      framework: "test",
    });
    const project = await prisma.project.findUniqueOrThrow({
      where: { slug: result.projectSlug },
    });
    return project;
  }

  // Helper to create a project directly in the DB (no Langy key) — simulates a
  // project that predates Langy keys, for the first-call heal path.
  async function createLegacyProject(name: string) {
    return prisma.project.create({
      data: {
        name,
        slug: `--legacy-${testNamespace}-${nanoid(6)}`,
        apiKey: `sk-lw-test-${nanoid()}`,
        teamId,
        language: "en",
        framework: "test",
      },
    });
  }

  describe("when a new project is created", () => {
    /** @scenario "Creating a project provisions a dedicated Langy key" */
    it("provisions a dedicated Langy key that is a service key", async () => {
      const project = await createProjectViaApi("Provisions Langy Key");

      // Best-effort provisioning happens after creation — wait for it.
      const keys = await vi.waitFor(
        async () => {
          const found = await findLangyKeys(project.id);
          expect(found).toHaveLength(1);
          return found;
        },
        { timeout: 5000, interval: 100 },
      );

      const langyKey = keys[0]!;
      expect(langyKey.userId).toBeNull(); // service key, owned by no human
      expect(langyKey.name).toBe(LANGY_API_KEY_NAME);
    });

    it("provisions a key distinct from the project's own ingestion apiKey", async () => {
      const project = await createProjectViaApi("Distinct From Ingestion Key");

      const keys = await vi.waitFor(async () => {
        const found = await findLangyKeys(project.id);
        expect(found).toHaveLength(1);
        return found;
      });

      // The Langy key is a separate ApiKey row, not the project.apiKey string.
      expect(keys[0]!.lookupId).not.toBe(project.apiKey);
    });

    /** @scenario "The Langy key is scoped to only its own project" */
    it("scopes the Langy key to only its own project", async () => {
      const project = await createProjectViaApi("Project Scoped");

      const keys = await vi.waitFor(async () => {
        const found = await findLangyKeys(project.id);
        expect(found).toHaveLength(1);
        return found;
      });

      const bindings = keys[0]!.roleBindings;
      expect(bindings.length).toBeGreaterThan(0);
      for (const b of bindings) {
        expect(b.scopeType).toBe(RoleBindingScopeType.PROJECT);
        expect(b.scopeId).toBe(project.id);
      }
    });

    /** @scenario "The Langy key grants only the access Langy needs" */
    it("grants least-privilege (no organization-level admin)", async () => {
      const project = await createProjectViaApi("Least Privilege");

      const keys = await vi.waitFor(async () => {
        const found = await findLangyKeys(project.id);
        expect(found).toHaveLength(1);
        return found;
      });

      const langyKey = keys[0]!;
      // restricted mode = scoped to an explicit permission set, not "all"/admin.
      expect(langyKey.permissionMode).toBe("restricted");
      // No org-wide binding of any kind.
      const orgBindings = langyKey.roleBindings.filter(
        (b) => b.scopeType === RoleBindingScopeType.ORGANIZATION,
      );
      expect(orgBindings).toHaveLength(0);
    });
  });

  describe("when a project predates Langy keys (first-call heal)", () => {
    /** @scenario "Existing projects without a Langy key heal on first call" */
    it("provisions a Langy key for a project that has none", async () => {
      const project = await createLegacyProject("Heal Target");
      expect(await findLangyKeys(project.id)).toHaveLength(0);

      await provisionLangyApiKey({
        prisma,
        projectId: project.id,
        organizationId,
        createdByUserId: userId,
      });

      expect(await findLangyKeys(project.id)).toHaveLength(1);
    });

    /** @scenario "Repeated heal calls do not create duplicates" */
    it("does not create duplicates when called repeatedly", async () => {
      const project = await createLegacyProject("Idempotent Heal");

      await provisionLangyApiKey({
        prisma,
        projectId: project.id,
        organizationId,
        createdByUserId: userId,
      });
      await provisionLangyApiKey({
        prisma,
        projectId: project.id,
        organizationId,
        createdByUserId: userId,
      });

      expect(await findLangyKeys(project.id)).toHaveLength(1);
    });
  });
});
