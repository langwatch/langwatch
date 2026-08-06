/**
 * @vitest-environment node
 *
 * A budget that can never accrue is refused at the moment it is written.
 *
 * Real Postgres, no mocks: whether a budget is reachable depends on virtual
 * key scopes and on the project a key's traces land in, which is exactly the
 * pair a stub would have to fake, and faking it would only prove the stub
 * agrees with itself.
 *
 * Spec: specs/ai-gateway/gateway-budget-targeting.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { toBudgetDto } from "../budget.dto";
import { GatewayBudgetService } from "../budget.service";

const suffix = nanoid(8);

/** An organization whose one active key sends traffic to LIVE_PROJECT_ID. */
const ORG_ID = `org-unreach-${suffix}`;
const TEAM_ID = `team-unreach-${suffix}`;
const LIVE_PROJECT_ID = `proj-unreach-live-${suffix}`;
/** A project of the same organization that no key traces to. */
const IDLE_PROJECT_ID = `proj-unreach-idle-${suffix}`;
const VK_ID = `vk_unreach_${suffix}`;

/** A second organization, freshly created and holding no keys at all. */
const EMPTY_ORG_ID = `org-empty-${suffix}`;
const EMPTY_TEAM_ID = `team-empty-${suffix}`;
const EMPTY_PROJECT_ID = `proj-empty-${suffix}`;

const ADMIN_ID = `usr-admin-${suffix}`;

const service = () => GatewayBudgetService.create(prisma, undefined);

async function createProjectBudget(options: {
  organizationId: string;
  projectId: string;
  allowUnreachable?: boolean;
}) {
  return await service().create({
    organizationId: options.organizationId,
    scope: { kind: "PROJECT", projectId: options.projectId },
    name: `budget-${nanoid(6)}`,
    window: "DAY",
    limitUsd: "10",
    allowUnreachable: options.allowUnreachable,
    actorUserId: ADMIN_ID,
  });
}

async function createProject({ id, teamId }: { id: string; teamId: string }) {
  await prisma.project.create({
    data: {
      id,
      name: id,
      slug: id,
      teamId,
      language: "en",
      framework: "openai",
      apiKey: `key-${id}`,
    },
  });
}

describe("given an organization whose keys all send traffic to one project", () => {
  beforeAll(async () => {
    await startTestContainers();

    await prisma.user.create({
      data: { id: ADMIN_ID, email: `${ADMIN_ID}@acme.test`, name: ADMIN_ID },
    });

    for (const [orgId, teamId] of [
      [ORG_ID, TEAM_ID],
      [EMPTY_ORG_ID, EMPTY_TEAM_ID],
    ]) {
      await prisma.organization.create({
        data: { id: orgId!, name: `Org ${orgId}`, slug: orgId! },
      });
      await prisma.team.create({
        data: {
          id: teamId!,
          name: `Team ${teamId}`,
          slug: teamId!,
          organizationId: orgId!,
        },
      });
    }

    await createProject({ id: LIVE_PROJECT_ID, teamId: TEAM_ID });
    await createProject({ id: IDLE_PROJECT_ID, teamId: TEAM_ID });
    await createProject({ id: EMPTY_PROJECT_ID, teamId: EMPTY_TEAM_ID });

    await prisma.virtualKey.create({
      data: {
        id: VK_ID,
        organizationId: ORG_ID,
        name: "live-key",
        hashedSecret: `hash-${VK_ID}`,
        displayPrefix: "vk-lw-xxxxxxx",
        createdById: ADMIN_ID,
        scopes: {
          create: [{ scopeType: "PROJECT", scopeId: LIVE_PROJECT_ID }],
        },
      },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.gatewayBudget.deleteMany({
      where: { organizationId: { in: [ORG_ID, EMPTY_ORG_ID] } },
    });
    await prisma.virtualKey.deleteMany({ where: { id: VK_ID } });
    await prisma.project.deleteMany({
      where: { teamId: { in: [TEAM_ID, EMPTY_TEAM_ID] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [TEAM_ID, EMPTY_TEAM_ID] } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [ORG_ID, EMPTY_ORG_ID] } },
    });
    await prisma.user.deleteMany({ where: { id: ADMIN_ID } });
    await stopTestContainers();
  }, 120_000);

  describe("when an admin budgets a project none of them reach", () => {
    /** @scenario "A budget no active key can reach is refused when it is created" */
    it("refuses it and names where the traffic actually goes", async () => {
      const refusal = await createProjectBudget({
        organizationId: ORG_ID,
        projectId: IDLE_PROJECT_ID,
      }).catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(Error);
      const error = refusal as {
        code?: string;
        meta?: Record<string, unknown>;
      };
      expect(error.code).toBe("gateway_budget_scope_unreachable");
      expect(error.meta?.scope_type).toBe("project");
      expect(error.meta?.reachable_project_ids).toEqual([LIVE_PROJECT_ID]);
      expect(error.meta?.reachable_project_count).toBe(1);

      // The refusal has to be a refusal: a row written and then reported as
      // an error would leave a budget nobody believes exists.
      const written = await prisma.gatewayBudget.count({
        where: { organizationId: ORG_ID, scopeId: IDLE_PROJECT_ID },
      });
      expect(written).toBe(0);
    });
  });

  describe("when an admin insists on keeping it anyway", () => {
    /** @scenario "An admin can insist on a budget that nothing reaches yet" */
    it("creates it", async () => {
      const budget = await createProjectBudget({
        organizationId: ORG_ID,
        projectId: IDLE_PROJECT_ID,
        allowUnreachable: true,
      });

      expect(budget.scopeId).toBe(IDLE_PROJECT_ID);
    });

    /** @scenario "A budget that nothing reaches says so when it is read back" */
    it("says so on the wire when the budget is read back", async () => {
      const budget = await createProjectBudget({
        organizationId: ORG_ID,
        projectId: IDLE_PROJECT_ID,
        allowUnreachable: true,
      });

      const found = await service().getWithHealth(budget.id, ORG_ID);
      expect(found?.unreachableByAnyKey).toBe(true);
      expect(
        toBudgetDto({
          budget: found!.budget,
          reachable: !found!.unreachableByAnyKey,
        }).scope_reach,
      ).toBe("unreachable");
    });
  });

  describe("when an admin budgets the project the keys do reach", () => {
    it("creates it without being asked to insist", async () => {
      const budget = await createProjectBudget({
        organizationId: ORG_ID,
        projectId: LIVE_PROJECT_ID,
      });

      expect(budget.scopeId).toBe(LIVE_PROJECT_ID);
    });
  });

  describe("when the organization has no active keys at all", () => {
    /** @scenario "An admin can still create a budget before any key exists" */
    it("creates the budget rather than calling it unreachable", async () => {
      const budget = await createProjectBudget({
        organizationId: EMPTY_ORG_ID,
        projectId: EMPTY_PROJECT_ID,
      });

      expect(budget.scopeId).toBe(EMPTY_PROJECT_ID);
    });
  });
});
