/**
 * @vitest-environment node
 *
 * What a routing policy stores, and what it refuses to store.
 *
 * Real Postgres, no mocks: the interesting behavior is which columns a
 * mutation writes, which guards fire before it does, and what a partial
 * update leaves alone. A stubbed client would only assert that the stub
 * agrees with itself.
 *
 * The change-feed half of this service is covered separately in
 * routingPolicy.changeEvents.integration.test.ts.
 *
 * Spec: specs/ai-gateway/governance/admin-routing-policies.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import {
  RoutingPolicyMustHaveProviderError,
  RoutingPolicyMustHaveScopeError,
  RoutingPolicyService,
} from "../routingPolicy.service";

const suffix = nanoid(8);

const ORG_ID = `org-rps-${suffix}`;
const OTHER_ORG_ID = `org-rps-other-${suffix}`;
const TEAM_ID = `team-rps-${suffix}`;
const PROJECT_ID = `proj-rps-${suffix}`;
const USER_ID = `usr-rps-${suffix}`;
const MP_OPENAI_ID = `mp-rps-openai-${suffix}`;
const MP_FOREIGN_ID = `mp-rps-foreign-${suffix}`;

const createdPolicyIds: string[] = [];

function service(): RoutingPolicyService {
  return new RoutingPolicyService(prisma);
}

async function createPolicy(
  overrides: Partial<Parameters<RoutingPolicyService["create"]>[0]> = {},
) {
  const policy = await service().create({
    organizationId: ORG_ID,
    scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
    name: `rps-${nanoid(6)}`,
    modelProviderIds: [MP_OPENAI_ID],
    actorUserId: USER_ID,
    ...overrides,
  });
  createdPolicyIds.push(policy.id);
  return policy;
}

describe("given an organization with a model provider", () => {
  beforeAll(async () => {
    await startTestContainers();

    for (const [id, slug] of [
      [ORG_ID, `rps-${suffix}`],
      [OTHER_ORG_ID, `rps-other-${suffix}`],
    ] as const) {
      await prisma.organization.create({
        data: { id, name: `RPS ${slug}`, slug },
      });
    }
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `RPS Team ${suffix}`,
        slug: `rps-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `RPS Project ${suffix}`,
        slug: `rps-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `rps-key-${suffix}`,
      },
    });
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: `rps-${suffix}@example.com`,
        name: "RPS Tester",
      },
    });
    await prisma.modelProvider.create({
      data: {
        id: MP_OPENAI_ID,
        organizationId: ORG_ID,
        name: `RPS openai`,
        provider: "openai",
        enabled: true,
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
      },
    });
    // Owned by a different organization, so it must never be reachable here.
    await prisma.modelProvider.create({
      data: {
        id: MP_FOREIGN_ID,
        organizationId: OTHER_ORG_ID,
        name: `RPS foreign`,
        provider: "openai",
        enabled: true,
        scopes: {
          create: [{ scopeType: "ORGANIZATION", scopeId: OTHER_ORG_ID }],
        },
      },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.gatewayChangeEvent.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.routingPolicy.deleteMany({
      where: { id: { in: createdPolicyIds } },
    });
    await prisma.modelProvider.deleteMany({
      where: { id: { in: [MP_OPENAI_ID, MP_FOREIGN_ID] } },
    });
    await prisma.project.deleteMany({ where: { id: PROJECT_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.organization.deleteMany({
      where: { id: { in: [ORG_ID, OTHER_ORG_ID] } },
    });
    await stopTestContainers();
  }, 120_000);

  describe("when a policy is created", () => {
    it("stores the tier targets and the default model together", async () => {
      const policy = await createPolicy({
        modelAliases: {
          complex: "anthropic/claude-opus-4-5",
          "gpt-4o": "openai/gpt-5-mini",
        },
        defaultModel: "openai/gpt-5-mini",
      });

      expect(policy.modelAliases).toEqual({
        complex: "anthropic/claude-opus-4-5",
        "gpt-4o": "openai/gpt-5-mini",
      });
      expect(policy.defaultModel).toBe("openai/gpt-5-mini");
    });

    it("defaults a policy with no tier opinion to no default model", async () => {
      const policy = await createPolicy();

      expect(policy.defaultModel).toBeNull();
      expect(policy.modelAliases).toEqual({});
    });

    it("refuses a policy that applies nowhere", async () => {
      await expect(
        service().create({
          organizationId: ORG_ID,
          scopes: [],
          name: `rps-noscope-${suffix}`,
          modelProviderIds: [MP_OPENAI_ID],
          actorUserId: USER_ID,
        }),
      ).rejects.toBeInstanceOf(RoutingPolicyMustHaveScopeError);
    });

    it("refuses a policy with no provider to route through", async () => {
      await expect(
        service().create({
          organizationId: ORG_ID,
          scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
          name: `rps-noprovider-${suffix}`,
          modelProviderIds: [],
          actorUserId: USER_ID,
        }),
      ).rejects.toBeInstanceOf(RoutingPolicyMustHaveProviderError);
    });

    it("refuses a provider another organization owns", async () => {
      // The provider id is guessable, so the guard is what stops one
      // organization routing through another's credentials.
      await expect(
        service().create({
          organizationId: ORG_ID,
          scopes: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }],
          name: `rps-foreign-${suffix}`,
          modelProviderIds: [MP_OPENAI_ID, MP_FOREIGN_ID],
          actorUserId: USER_ID,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("when a policy is updated", () => {
    it("changes only the fields the caller named", async () => {
      const policy = await createPolicy({
        modelAliases: { fast: "openai/gpt-5-mini" },
        defaultModel: "openai/gpt-5-mini",
        description: "before",
      });

      const updated = await service().update({
        id: policy.id,
        organizationId: ORG_ID,
        name: `${policy.name}-renamed`,
        actorUserId: USER_ID,
      });

      expect(updated.name).toBe(`${policy.name}-renamed`);
      expect(updated.description).toBe("before");
      expect(updated.modelAliases).toEqual({ fast: "openai/gpt-5-mini" });
      expect(updated.defaultModel).toBe("openai/gpt-5-mini");
    });

    it("clears the default model when the caller sends null", async () => {
      const policy = await createPolicy({ defaultModel: "openai/gpt-5-mini" });

      const updated = await service().update({
        id: policy.id,
        organizationId: ORG_ID,
        defaultModel: null,
        actorUserId: USER_ID,
      });

      expect(updated.defaultModel).toBeNull();
    });

    it("replaces the whole name mapping rather than merging into it", async () => {
      // Merging would make a removed mapping unremovable through the editor,
      // which sends the complete map every time.
      const policy = await createPolicy({
        modelAliases: { fast: "openai/gpt-5-mini", "gpt-4o": "openai/gpt-5" },
      });

      const updated = await service().update({
        id: policy.id,
        organizationId: ORG_ID,
        modelAliases: { fast: "openai/gpt-5-nano" },
        actorUserId: USER_ID,
      });

      expect(updated.modelAliases).toEqual({ fast: "openai/gpt-5-nano" });
    });

    it("refuses to empty the provider list", async () => {
      const policy = await createPolicy();

      await expect(
        service().update({
          id: policy.id,
          organizationId: ORG_ID,
          modelProviderIds: [],
          actorUserId: USER_ID,
        }),
      ).rejects.toBeInstanceOf(RoutingPolicyMustHaveProviderError);
    });

    it("refuses to edit a policy another organization owns", async () => {
      const policy = await createPolicy();

      await expect(
        service().update({
          id: policy.id,
          organizationId: OTHER_ORG_ID,
          name: "stolen",
          actorUserId: USER_ID,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("when a default is set", () => {
    it("leaves exactly one default at the scope", async () => {
      const first = await createPolicy({ isDefault: true });
      const second = await createPolicy();

      await service().setDefault({
        id: second.id,
        organizationId: ORG_ID,
        actorUserId: USER_ID,
      });

      const rows = await prisma.routingPolicy.findMany({
        where: { id: { in: [first.id, second.id] } },
        select: { id: true, isDefault: true },
      });
      expect(rows.find((row) => row.id === first.id)?.isDefault).toBe(false);
      expect(rows.find((row) => row.id === second.id)?.isDefault).toBe(true);
    });
  });
});
