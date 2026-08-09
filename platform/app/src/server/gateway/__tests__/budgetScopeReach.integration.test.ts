/**
 * @vitest-environment node
 *
 * Which budgets can any active key in an organization actually spend against?
 *
 * Real Postgres, no mocks: the answer depends on virtual key scopes, on the
 * project a key's traces land in, and on group membership, so stubbing the
 * database would only assert that the stub agrees with itself.
 *
 * The scopes that resolve through something other than the key row itself
 * are the ones worth pinning. A per-person budget anchors on a key or a
 * project rather than naming the people it covers, and a group budget
 * enforces through whoever the key is attributed to, so both are reachable
 * for reasons no field on the budget states outright. Reporting either as
 * unreachable puts a warning on a budget that is enforcing.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

import { resolveBudgetScopeReach } from "../budgetScopeReach";

const suffix = nanoid(8);
const ORG_ID = `org-reach-${suffix}`;
const TEAM_ID = `team-reach-${suffix}`;
/** The project the served key's traces land in. */
const PROJECT_ID = `proj-reach-${suffix}`;
/** A project of this organization that no active key traces to. */
const IDLE_PROJECT_ID = `proj-reach-idle-${suffix}`;

/** Holds the attributed key, and is a member of the covered group. */
const MEMBER_ID = `usr-member-${suffix}`;
/** In a group of their own, holding no key at all. */
const OUTSIDER_ID = `usr-outsider-${suffix}`;
/** Holds an active key that names nobody as its principal. */
const SHARED_OWNER_ID = `usr-shared-${suffix}`;

const VK_ID = `vk_reach_${suffix}`;
const SHARED_VK_ID = `vk_shared_${suffix}`;

const COVERED_GROUP_ID = `grp-covered-${suffix}`;
const KEYLESS_GROUP_ID = `grp-keyless-${suffix}`;
const SHARED_GROUP_ID = `grp-shared-${suffix}`;

const SEAT_ON_KEY_ID = `bdg-seat-key-${suffix}`;
const SEAT_ON_PROJECT_ID = `bdg-seat-proj-${suffix}`;
const SEAT_ON_IDLE_ID = `bdg-seat-idle-${suffix}`;
const GROUP_COVERED_ID = `bdg-grp-covered-${suffix}`;
const GROUP_KEYLESS_ID = `bdg-grp-keyless-${suffix}`;
const GROUP_SHARED_ID = `bdg-grp-shared-${suffix}`;

async function createBudget(options: {
  id: string;
  scopeType: "ATTRIBUTED_USER" | "GROUP";
  scopeId: string;
}) {
  await prisma.gatewayBudget.create({
    data: {
      id: options.id,
      name: options.id,
      organizationId: ORG_ID,
      scopeType: options.scopeType,
      scopeId: options.scopeId,
      window: "DAY",
      limitUsd: "1",
      onBreach: "BLOCK",
      createdById: MEMBER_ID,
      resetsAt: new Date(Date.now() + 86_400_000),
    },
  });
}

/** Reach for one budget, resolved over every active key in the org. */
async function reachOf(budgetId: string): Promise<boolean | undefined> {
  const budgets = await prisma.gatewayBudget.findMany({
    where: { organizationId: ORG_ID, archivedAt: null },
  });
  const reach = await resolveBudgetScopeReach({
    prisma,
    organizationId: ORG_ID,
    budgets,
  });
  return reach.get(budgetId)?.reachable;
}

describe("given per-person and group budgets in an organization", () => {
  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.create({
      data: { id: ORG_ID, name: `Org ${suffix}`, slug: ORG_ID },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Team ${suffix}`,
        slug: TEAM_ID,
        organizationId: ORG_ID,
      },
    });
    for (const id of [PROJECT_ID, IDLE_PROJECT_ID]) {
      await prisma.project.create({
        data: {
          id,
          name: id,
          slug: id,
          teamId: TEAM_ID,
          language: "en",
          framework: "openai",
          apiKey: `key-${id}`,
        },
      });
    }
    for (const id of [MEMBER_ID, OUTSIDER_ID, SHARED_OWNER_ID]) {
      await prisma.user.create({
        data: { id, email: `${id}@acme.test`, name: id },
      });
    }

    await prisma.virtualKey.create({
      data: {
        id: VK_ID,
        organizationId: ORG_ID,
        name: "attributed-key",
        hashedSecret: `hash-${VK_ID}`,
        displayPrefix: "vk-lw-xxxxxxx",
        principalUserId: MEMBER_ID,
        createdById: MEMBER_ID,
        scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
      },
    });
    // Active, and traces to the same project, but attributed to nobody.
    await prisma.virtualKey.create({
      data: {
        id: SHARED_VK_ID,
        organizationId: ORG_ID,
        name: "shared-key",
        hashedSecret: `hash-${SHARED_VK_ID}`,
        displayPrefix: "vk-lw-yyyyyyy",
        createdById: SHARED_OWNER_ID,
        scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
      },
    });

    const groups: [string, string][] = [
      [COVERED_GROUP_ID, MEMBER_ID],
      [KEYLESS_GROUP_ID, OUTSIDER_ID],
      [SHARED_GROUP_ID, SHARED_OWNER_ID],
    ];
    for (const [groupId, userId] of groups) {
      await prisma.group.create({
        data: {
          id: groupId,
          name: groupId,
          slug: groupId,
          organizationId: ORG_ID,
          members: { create: [{ userId }] },
        },
      });
    }

    await createBudget({
      id: SEAT_ON_KEY_ID,
      scopeType: "ATTRIBUTED_USER",
      scopeId: VK_ID,
    });
    await createBudget({
      id: SEAT_ON_PROJECT_ID,
      scopeType: "ATTRIBUTED_USER",
      scopeId: PROJECT_ID,
    });
    await createBudget({
      id: SEAT_ON_IDLE_ID,
      scopeType: "ATTRIBUTED_USER",
      scopeId: IDLE_PROJECT_ID,
    });
    await createBudget({
      id: GROUP_COVERED_ID,
      scopeType: "GROUP",
      scopeId: COVERED_GROUP_ID,
    });
    await createBudget({
      id: GROUP_KEYLESS_ID,
      scopeType: "GROUP",
      scopeId: KEYLESS_GROUP_ID,
    });
    await createBudget({
      id: GROUP_SHARED_ID,
      scopeType: "GROUP",
      scopeId: SHARED_GROUP_ID,
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.gatewayBudget.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.group.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.virtualKey.deleteMany({
      where: { id: { in: [VK_ID, SHARED_VK_ID] } },
    });
    await prisma.project.deleteMany({ where: { teamId: TEAM_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await prisma.user.deleteMany({
      where: { id: { in: [MEMBER_ID, OUTSIDER_ID, SHARED_OWNER_ID] } },
    });
    await stopTestContainers();
  }, 120_000);

  describe("when a per-person budget is anchored on an active key", () => {
    /** @scenario "A per-person budget anchored on a key that serves traffic carries no warning" */
    it("reports it as reachable", async () => {
      expect(await reachOf(SEAT_ON_KEY_ID)).toBe(true);
    });
  });

  describe("when a per-person budget is anchored on a project a key traces to", () => {
    it("reports it as reachable", async () => {
      expect(await reachOf(SEAT_ON_PROJECT_ID)).toBe(true);
    });
  });

  describe("when a per-person budget is anchored where no key sends traffic", () => {
    /** @scenario "A per-person budget anchored where no key sends traffic warns" */
    it("reports it as unreachable", async () => {
      expect(await reachOf(SEAT_ON_IDLE_ID)).toBe(false);
    });
  });

  describe("when a group budget covers someone who holds a key", () => {
    /** @scenario "A group budget carries no warning when a member holds a key" */
    it("reports it as reachable", async () => {
      expect(await reachOf(GROUP_COVERED_ID)).toBe(true);
    });
  });

  describe("when a group budget covers nobody who holds a key", () => {
    it("reports it as unreachable", async () => {
      expect(await reachOf(GROUP_KEYLESS_ID)).toBe(false);
    });
  });

  describe("when the only key a covered member holds names no principal", () => {
    /** @scenario "A group budget warns when its members' traffic cannot be attributed to them" */
    it("reports it as unreachable, since there is nobody to charge", async () => {
      // The key is active and traces into the same project as the
      // attributed one, so it is the missing principal alone that keeps
      // the per-member bucket unreachable.
      expect(await reachOf(GROUP_SHARED_ID)).toBe(false);
    });
  });
});
