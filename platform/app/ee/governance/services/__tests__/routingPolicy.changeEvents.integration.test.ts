/**
 * @vitest-environment node
 *
 * A routing-policy edit has to reach a running gateway, and the change feed
 * is how it gets there.
 *
 * Real Postgres, no mocks: what is under test is which rows a mutation
 * leaves behind and whether they land together, so a stubbed client would
 * only assert that the stub agrees with itself. The interesting cases are
 * the ones where the row written is not the row edited: a policy edit has
 * to bump keys that merely point at the policy, and a policy delete has to
 * release them without leaving one naming a policy that is gone.
 *
 * Spec: specs/ai-gateway/auth-cache.feature, Rule "A routing-policy or
 * cache-rule edit propagates through the change feed".
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { RoutingPolicyService } from "../routingPolicy.service";

const suffix = nanoid(8);

const ORG_ID = `org-rpce-${suffix}`;
const TEAM_ID = `team-rpce-${suffix}`;
const PROJECT_ID = `proj-rpce-${suffix}`;
const USER_ID = `usr-rpce-${suffix}`;
const MP_OPENAI_ID = `mp-rpce-openai-${suffix}`;
const MP_ANTHROPIC_ID = `mp-rpce-anthropic-${suffix}`;

/** Ids minted per test, torn down by exactly these ids. */
const createdPolicyIds: string[] = [];
const createdKeyIds: string[] = [];

function service(): RoutingPolicyService {
  return new RoutingPolicyService(prisma);
}

async function createPolicy(label: string): Promise<string> {
  const policy = await service().create({
    organizationId: ORG_ID,
    scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
    name: `rpce-${label}-${suffix}`,
    modelProviderIds: [MP_OPENAI_ID],
    actorUserId: USER_ID,
  });
  createdPolicyIds.push(policy.id);
  return policy.id;
}

async function createKey(args: {
  label: string;
  routingPolicyId: string | null;
}): Promise<string> {
  const id = `vk-rpce-${args.label}-${suffix}`;
  await prisma.virtualKey.create({
    data: {
      id,
      organizationId: ORG_ID,
      name: id,
      hashedSecret: `hash-${id}`,
      displayPrefix: "vk-lw-rpce",
      config: {},
      createdById: USER_ID,
      routingPolicyId: args.routingPolicyId,
      routingMode: args.routingPolicyId ? "POLICY" : "NONE",
      scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
    },
  });
  createdKeyIds.push(id);
  return id;
}

async function changeEventKinds(): Promise<string[]> {
  const events = await prisma.gatewayChangeEvent.findMany({
    where: { organizationId: ORG_ID },
    orderBy: { revision: "asc" },
    select: { kind: true },
  });
  return events.map((event) => event.kind);
}

async function revisionOf(id: string): Promise<bigint> {
  const key = await prisma.virtualKey.findUniqueOrThrow({
    where: { id },
    select: { revision: true },
  });
  return key.revision;
}

describe("given a routing policy the gateway has already materialised into bundles", () => {
  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.create({
      data: { id: ORG_ID, name: `RPCE ${suffix}`, slug: `rpce-${suffix}` },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `RPCE Team ${suffix}`,
        slug: `rpce-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `RPCE Project ${suffix}`,
        slug: `rpce-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `rpce-key-${suffix}`,
      },
    });
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: `rpce-${suffix}@example.com`,
        name: "RPCE Tester",
      },
    });
    for (const [id, provider] of [
      [MP_OPENAI_ID, "openai"],
      [MP_ANTHROPIC_ID, "anthropic"],
    ] as const) {
      await prisma.modelProvider.create({
        data: {
          id,
          organizationId: ORG_ID,
          name: `RPCE ${provider}`,
          provider,
          enabled: true,
          scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
        },
      });
    }
  }, 120_000);

  // Each test asserts on the whole feed for this organization, so the feed
  // starts empty rather than carrying the previous test's events.
  beforeEach(async () => {
    await prisma.gatewayChangeEvent.deleteMany({
      where: { organizationId: ORG_ID },
    });
  });

  afterAll(async () => {
    await prisma.gatewayChangeEvent.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.virtualKey.deleteMany({
      where: { organizationId: ORG_ID, id: { in: createdKeyIds } },
    });
    await prisma.routingPolicy.deleteMany({
      where: { organizationId: ORG_ID, id: { in: createdPolicyIds } },
    });
    await prisma.modelProvider.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
  }, 120_000);

  describe("when an admin edits the policy", () => {
    /** @scenario "editing a routing policy appends one change event and bumps its keys" */
    it("appends exactly one ROUTING_POLICY_UPDATED and bumps only the keys that reference it", async () => {
      const policyId = await createPolicy("edited");
      const referencingA = await createKey({
        label: "ref-a",
        routingPolicyId: policyId,
      });
      const referencingB = await createKey({
        label: "ref-b",
        routingPolicyId: policyId,
      });
      const unrelated = await createKey({
        label: "unrelated",
        routingPolicyId: null,
      });
      const before = {
        referencingA: await revisionOf(referencingA),
        referencingB: await revisionOf(referencingB),
        unrelated: await revisionOf(unrelated),
      };

      await service().update({
        id: policyId,
        organizationId: ORG_ID,
        modelProviderIds: [MP_OPENAI_ID, MP_ANTHROPIC_ID],
        actorUserId: USER_ID,
      });

      expect(await changeEventKinds()).toEqual(["ROUTING_POLICY_UPDATED"]);
      expect(await revisionOf(referencingA)).toBe(before.referencingA + 1n);
      expect(await revisionOf(referencingB)).toBe(before.referencingB + 1n);
      expect(await revisionOf(unrelated)).toBe(before.unrelated);
    });

    describe("given the edit is rejected", () => {
      it("writes neither the policy change nor the event", async () => {
        const policyId = await createPolicy("rejected");
        const key = await createKey({
          label: "rejected-ref",
          routingPolicyId: policyId,
        });
        const revisionBefore = await revisionOf(key);
        const nameBefore = (
          await prisma.routingPolicy.findUniqueOrThrow({
            where: { id: policyId },
            select: { name: true },
          })
        ).name;

        await expect(
          service().update({
            id: policyId,
            organizationId: ORG_ID,
            name: `rpce-never-lands-${suffix}`,
            // No such user, so connecting `updatedBy` fails and the
            // transaction rolls back.
            actorUserId: `usr-rpce-missing-${suffix}`,
          }),
        ).rejects.toThrow();

        expect(await changeEventKinds()).toEqual([]);
        expect(await revisionOf(key)).toBe(revisionBefore);
        const policy = await prisma.routingPolicy.findUniqueOrThrow({
          where: { id: policyId },
          select: { name: true },
        });
        expect(policy.name).toBe(nameBefore);
      });
    });
  });

  describe("when an admin deletes the policy", () => {
    /** @scenario "deleting a routing policy releases the keys that pointed at it" */
    it("appends ROUTING_POLICY_DELETED and moves the released key off policy routing", async () => {
      const policyId = await createPolicy("deleted");
      const key = await createKey({
        label: "deleted-ref",
        routingPolicyId: policyId,
      });
      const revisionBefore = await revisionOf(key);

      await service().delete({ id: policyId, organizationId: ORG_ID });

      expect(await changeEventKinds()).toEqual(["ROUTING_POLICY_DELETED"]);
      const released = await prisma.virtualKey.findUniqueOrThrow({
        where: { id: key },
        select: { routingPolicyId: true, routingMode: true, revision: true },
      });
      expect(released.routingPolicyId).toBeNull();
      expect(released.routingMode).toBe("FALLBACK_ALL");
      expect(released.revision).toBe(revisionBefore + 1n);
      expect(
        await prisma.routingPolicy.findUnique({ where: { id: policyId } }),
      ).toBeNull();
    });
  });

  describe("when an admin creates a policy and then makes it the default", () => {
    /** @scenario "creating a policy or swapping the default emits nothing" */
    it("appends no change event, because neither reaches an issued key's bundle", async () => {
      const existingDefaultId = await createPolicy("standing-default");
      await service().setDefault({
        id: existingDefaultId,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
      });

      const challengerId = await createPolicy("challenger");
      await service().setDefault({
        id: challengerId,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
      });

      expect(await changeEventKinds()).toEqual([]);
      const challenger = await prisma.routingPolicy.findUniqueOrThrow({
        where: { id: challengerId },
        select: { isDefault: true },
      });
      const dethroned = await prisma.routingPolicy.findUniqueOrThrow({
        where: { id: existingDefaultId },
        select: { isDefault: true },
      });
      expect(challenger.isDefault).toBe(true);
      expect(dethroned.isDefault).toBe(false);
    });
  });
});
