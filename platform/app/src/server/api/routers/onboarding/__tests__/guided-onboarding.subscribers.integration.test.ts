/**
 * The guided onboarding subscribers reached from real procedure writes
 * against a real Postgres: initializing an organization tracks the variant,
 * recording paths reaches PostHog and Customer.io, and a scenario created in
 * the organization's project carries the variant.
 *
 * @see specs/analytics/posthog-guided-onboarding.feature
 * @see specs/nurturing/guided-onboarding-customer-io.feature
 */
import type { NurturingService } from "@ee/billing/nurturing/nurturing.service";
import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "~/server/app-layer/organizations/repositories/organization.prisma.repository";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import type { PromptTagRepository } from "~/server/prompt-config/repositories/prompt-tag.repository";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { appRouter } from "../../../root";
import { createInnerTRPCContext } from "../../../trpc";

const { trackServerEvent } = vi.hoisted(() => ({ trackServerEvent: vi.fn() }));

vi.mock("~/server/posthog", () => ({ trackServerEvent }));

const nurturing = {
  identifyUser: vi.fn().mockResolvedValue(undefined),
  trackEvent: vi.fn().mockResolvedValue(undefined),
  groupUser: vi.fn().mockResolvedValue(undefined),
  batch: vi.fn().mockResolvedValue(undefined),
};

const suffix = nanoid(8);

const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];

type SeededUser = { id: string; name: string | null; email: string | null };

async function seedUser(label: string): Promise<SeededUser> {
  const user = await prisma.user.create({
    data: {
      name: `Guided ${label}`,
      email: `guided-subscribers-${label}-${suffix}@example.com`,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

function callerFor(user: SeededUser) {
  return appRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: { id: user.id, name: user.name, email: user.email },
        expires: "1",
      },
      permissionChecked: false,
    }) as never,
  );
}

function trackedEvents(): string[] {
  return trackServerEvent.mock.calls.map((call) => call[0].event);
}

describe("guided onboarding subscribers reached from procedure writes", () => {
  let owner: SeededUser;
  let organizationId: string;
  let projectId: string;

  beforeAll(async () => {
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({
      nurturing: nurturing as unknown as NurturingService,
      organizations: new OrganizationService(
        new PrismaOrganizationRepository(prisma),
        {
          seedForOrg: async () => {
            /* noop */
          },
        } as unknown as PromptTagRepository,
      ),
    });

    owner = await seedUser("owner");
  });

  afterAll(async () => {
    for (const id of createdOrganizationIds) {
      const projects = await prisma.project.findMany({
        where: { team: { organizationId: id } },
        select: { id: true },
      });
      const projectIds = projects.map((project) => project.id);
      if (projectIds.length > 0) {
        await cleanupTestRows(prisma, [
          ["scenarioVersion", { projectId: { in: projectIds } }],
          ["scenario", { projectId: { in: projectIds } }],
          ["simulationSuite", { projectId: { in: projectIds } }],
        ]);
        await prisma.projectSecret.deleteMany({
          where: { projectId: { in: projectIds } },
        });
      }
      await cleanupTestRows(prisma, [
        ["project", { team: { organizationId: id } }],
        ["aiToolEntry", { organizationId: id }],
        ["roleBinding", { organizationId: id }],
        ["teamUser", { team: { organizationId: id } }],
        ["team", { organizationId: id }],
        ["organizationUser", { organizationId: id }],
        ["organization", { id }],
      ]);
    }
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await resetApp();
  });

  beforeEach(() => {
    trackServerEvent.mockClear();
    nurturing.identifyUser.mockClear();
    nurturing.trackEvent.mockClear();
    nurturing.groupUser.mockClear();
  });

  describe("when a user initializes an organization with the guided variant", () => {
    /** @scenario "initializing an organization through the procedure tracks the assigned onboarding variant" */
    it("captures onboarding_variant_assigned for that user with variant guided", async () => {
      const result = await callerFor(owner).onboarding.initializeOrganization({
        orgName: `ACME Guided Subscribers ${suffix}`,
        onboardingVariant: "guided",
        signUpData: { companyType: "company" },
        language: "other",
        framework: "other",
      });
      organizationId = result.organizationId;
      createdOrganizationIds.push(organizationId);
      const project = await prisma.project.findFirstOrThrow({
        where: { team: { organizationId } },
        select: { id: true },
      });
      projectId = project.id;

      expect(trackServerEvent).toHaveBeenCalledWith({
        userId: owner.id,
        event: "onboarding_variant_assigned",
        properties: {
          variant: "guided",
          organization_id: organizationId,
          $set: { onboarding_variant: "guided" },
        },
      });
    });
  });

  describe("when a user initializes an organization without a variant", () => {
    /** @scenario "initializing an organization without a variant tracks no variant assignment" */
    it("captures no onboarding_variant_assigned", async () => {
      const classic = await seedUser("classic");
      const result = await callerFor(classic).onboarding.initializeOrganization(
        {
          orgName: `ACME Classic Subscribers ${suffix}`,
          signUpData: { companyType: "company" },
          language: "other",
          framework: "other",
        },
      );
      createdOrganizationIds.push(result.organizationId);

      expect(trackedEvents()).not.toContain("onboarding_variant_assigned");
    });
  });

  describe("when the user records the paths gateway then llmops", () => {
    /** @scenario "a guided state write through the procedure reaches PostHog" */
    it("captures guided_onboarding_paths_selected for that user with primary_path gateway", async () => {
      await callerFor(owner).onboarding.recordPaths({
        organizationId,
        paths: ["gateway", "llmops"],
      });

      await vi.waitFor(() => {
        expect(trackServerEvent).toHaveBeenCalledWith({
          userId: owner.id,
          event: "guided_onboarding_paths_selected",
          properties: {
            paths: ["gateway", "llmops"],
            primary_path: "gateway",
            organization_id: organizationId,
            $set: {
              onboarding_variant: "guided",
              onboarding_paths: ["gateway", "llmops"],
              onboarding_primary_path: "gateway",
            },
          },
        });
      });
    });

    /** @scenario "a guided state write through the procedure reaches Customer.io" */
    it("identifies the user and tracks one campaign trigger per path", async () => {
      await callerFor(owner).onboarding.recordPaths({
        organizationId,
        paths: ["gateway", "llmops"],
      });

      await vi.waitFor(() => {
        expect(nurturing.identifyUser).toHaveBeenCalledWith({
          userId: owner.id,
          traits: {
            onboarding_variant: "guided",
            onboarding_paths: "gateway,llmops",
            onboarding_primary_path: "gateway",
          },
        });
        expect(nurturing.groupUser).toHaveBeenCalledWith({
          userId: owner.id,
          groupId: organizationId,
          traits: {
            onboarding_variant: "guided",
            onboarding_paths: "gateway,llmops",
            onboarding_primary_path: "gateway",
          },
        });
      });
      // The paths were already recorded by the PostHog test above, so this
      // second selection carries no new path: the campaign triggers fired
      // once, on the first selection, and never again.
      const events = nurturing.trackEvent.mock.calls.map(
        (call) => call[0].event,
      );
      expect(events).toContain("onboarding_paths_selected");
      expect(events).not.toContain("onboarding_path_gateway");
      expect(events).not.toContain("onboarding_path_llmops");
    });
  });

  describe("when the user begins the governance path from the Home offer", () => {
    it("tracks the governance campaign trigger once and no other", async () => {
      await callerFor(owner).onboarding.beginPath({
        organizationId,
        path: "governance",
      });

      await vi.waitFor(() => {
        expect(nurturing.trackEvent).toHaveBeenCalledWith({
          userId: owner.id,
          event: "onboarding_path_governance",
          properties: { path: "governance" },
        });
      });
      const events = nurturing.trackEvent.mock.calls.map(
        (call) => call[0].event,
      );
      expect(events).toEqual(["onboarding_path_governance"]);
    });
  });

  describe("when a scenario is created in the organization's project", () => {
    /** @scenario "scenario_created carries the onboarding variant of the organization" */
    it("captures scenario_created with onboarding_variant guided", async () => {
      await callerFor(owner).scenarios.create({
        projectId,
        name: "Guest completes checkout",
        situation: "A guest buys one item with a discount code",
        criteria: ["The order is confirmed"],
      });

      expect(trackServerEvent).toHaveBeenCalledWith({
        userId: owner.id,
        event: "scenario_created",
        projectId,
        properties: { onboarding_variant: "guided" },
      });
    });
  });
});
