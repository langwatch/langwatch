/**
 * The guided onboarding procedures against a real Postgres: every write lands
 * in Organization.signupData.guidedOnboarding and reads back, the variant is
 * recorded at organization creation, membership guards the writes, and every
 * write reaches the event hook.
 *
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "~/server/app-layer/organizations/repositories/organization.prisma.repository";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import type { PromptTagRepository } from "~/server/prompt-config/repositories/prompt-tag.repository";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { createInnerTRPCContext } from "../../../trpc";
import { onboardingRouter } from "../onboarding.router";

const { onGuidedOnboardingEvent } = vi.hoisted(() => ({
  onGuidedOnboardingEvent: vi.fn(),
}));

vi.mock("~/server/onboarding/guided-onboarding.events", () => ({
  onGuidedOnboardingEvent,
}));

const suffix = nanoid(8);

const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];

type SeededUser = { id: string; name: string | null; email: string | null };

async function seedUser(label: string): Promise<SeededUser> {
  const user = await prisma.user.create({
    data: {
      name: `Guided ${label}`,
      email: `guided-${label}-${suffix}@example.com`,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

function callerFor(user: SeededUser) {
  return onboardingRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: { id: user.id, name: user.name, email: user.email },
        expires: "1",
      },
      permissionChecked: false,
    }) as never,
  );
}

async function storedSignupData(organizationId: string) {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { signupData: true },
  });
  return organization.signupData as Record<string, unknown> | null;
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
}

describe("onboarding guided state", () => {
  let owner: SeededUser;
  let stranger: SeededUser;
  let organizationId: string;

  beforeAll(async () => {
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({
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
    stranger = await seedUser("stranger");

    const result = await callerFor(owner).initializeOrganization({
      orgName: `ACME Guided ${suffix}`,
      onboardingVariant: "guided",
      signUpData: { companyType: "company" },
      language: "other",
      framework: "other",
    });
    organizationId = result.organizationId;
    createdOrganizationIds.push(organizationId);
  });

  afterAll(async () => {
    for (const id of createdOrganizationIds) {
      const projects = await prisma.project.findMany({
        where: { team: { organizationId: id } },
        select: { id: true },
      });
      const projectIds = projects.map((project) => project.id);
      if (projectIds.length > 0) {
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
    onGuidedOnboardingEvent.mockClear();
  });

  describe("given an organization initialized with the guided variant", () => {
    /** @scenario "initializing an organization records the onboarding variant" */
    it("carries onboardingVariant guided next to the other sign-up answers", async () => {
      const signupData = await storedSignupData(organizationId);
      expect(signupData?.onboardingVariant).toBe("guided");
      expect(signupData?.companyType).toBe("company");
    });

    /** @scenario "an organization without guided state returns the empty default" */
    it("reads the empty default before anything was recorded", async () => {
      const state = await callerFor(owner).getGuidedState({ organizationId });
      expect(state).toEqual({ paths: [], donePaths: [] });
    });
  });

  describe("given an organization initialized without a variant", () => {
    /** @scenario "initializing an organization without a variant leaves the sign-up data unchanged" */
    it("carries no onboarding variant", async () => {
      const classic = await seedUser("classic");
      const result = await callerFor(classic).initializeOrganization({
        orgName: `ACME Classic ${suffix}`,
        signUpData: { companyType: "company" },
        language: "other",
        framework: "other",
      });
      createdOrganizationIds.push(result.organizationId);

      const signupData = await storedSignupData(result.organizationId);
      expect(signupData).toEqual({ companyType: "company" });
    });
  });

  describe("when the user records the paths gateway then llmops", () => {
    /** @scenario "recording paths stores them in pick order and starts the first one" */
    it("lists gateway before llmops and makes gateway the current path", async () => {
      const state = await callerFor(owner).recordPaths({
        organizationId,
        paths: ["gateway", "llmops"],
      });

      expect(state.paths).toEqual(["gateway", "llmops"]);
      expect(state.currentPath).toBe("gateway");

      const stored = await storedSignupData(organizationId);
      expect(stored?.guidedOnboarding).toMatchObject({
        paths: ["gateway", "llmops"],
        currentPath: "gateway",
      });
      expect(stored?.onboardingVariant).toBe("guided");
    });

    /** @scenario "every guided state write reaches the onboarding event hook" */
    it("hands the event hook a paths_selected event for that organization and user", async () => {
      await callerFor(owner).recordPaths({
        organizationId,
        paths: ["gateway", "llmops"],
      });

      expect(onGuidedOnboardingEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId,
          userId: owner.id,
          event: "paths_selected",
          payload: { paths: ["gateway", "llmops"], primaryPath: "gateway" },
        }),
      );
    });
  });

  describe("when the user records the provider", () => {
    /** @scenario "recording a provider stores the provider and its model" */
    it("stores the provider and its model", async () => {
      const state = await callerFor(owner).recordProvider({
        organizationId,
        provider: "openai",
        model: "gpt-5",
      });
      expect(state).toMatchObject({ provider: "openai", providerModel: "gpt-5" });
    });

    /** @scenario "skipping the provider is recorded" */
    it("records the time the provider was skipped", async () => {
      const state = await callerFor(owner).recordProviderSkipped({
        organizationId,
      });
      expect(typeof state.providerSkippedAt).toBe("string");
      expect(Number.isNaN(Date.parse(state.providerSkippedAt ?? ""))).toBe(
        false,
      );
    });
  });

  describe("when the user completes, skips and replays the tour", () => {
    /** @scenario "completing, skipping and replaying the tour are recorded" */
    it("records each instant and counts the replays", async () => {
      const caller = callerFor(owner);

      const completed = await caller.recordTour({
        organizationId,
        status: "completed",
      });
      expect(typeof completed.tourCompletedAt).toBe("string");

      const skipped = await caller.recordTour({
        organizationId,
        status: "skipped",
      });
      expect(typeof skipped.tourSkippedAt).toBe("string");
      expect(skipped.tourCompletedAt).toBe(completed.tourCompletedAt);

      await caller.recordTour({ organizationId, status: "replayed" });
      const replayed = await caller.recordTour({
        organizationId,
        status: "replayed",
      });
      expect(replayed.tourReplays).toBe(2);
    });
  });

  describe("when the user begins a path", () => {
    /** @scenario "beginning a path the user never picked appends it to the picked paths" */
    it("appends a path that was never picked and makes it current", async () => {
      const caller = callerFor(owner);
      await caller.recordPaths({ organizationId, paths: ["llmops"] });

      const state = await caller.beginPath({ organizationId, path: "governance" });

      expect(state.currentPath).toBe("governance");
      expect(state.paths).toEqual(["llmops", "governance"]);
    });

    /** @scenario "beginning a path the user already picked keeps the picked paths as they are" */
    it("keeps the picked paths as they are for a path already picked", async () => {
      const caller = callerFor(owner);
      await caller.recordPaths({ organizationId, paths: ["gateway", "llmops"] });

      const state = await caller.beginPath({ organizationId, path: "llmops" });

      expect(state.currentPath).toBe("llmops");
      expect(state.paths).toEqual(["gateway", "llmops"]);
    });
  });

  describe("when a path is completed twice", () => {
    /** @scenario "completing a path is idempotent" */
    it("lists it once among the done paths and clears the current path", async () => {
      const caller = callerFor(owner);
      await caller.beginPath({ organizationId, path: "llmops" });
      onGuidedOnboardingEvent.mockClear();

      await caller.completePath({ organizationId, path: "llmops" });
      const state = await caller.completePath({ organizationId, path: "llmops" });

      expect(state.donePaths.filter((path) => path === "llmops")).toHaveLength(1);
      expect(state.currentPath).toBeUndefined();
      expect(
        onGuidedOnboardingEvent.mock.calls.filter(
          ([input]) => input.event === "path_completed",
        ),
      ).toHaveLength(1);
    });
  });

  describe("when a path named billing is completed", () => {
    /** @scenario "an unknown path is rejected with a named error" */
    it("fails with the guided_onboarding_path_unknown code", async () => {
      await expect(
        codeOf(callerFor(owner).completePath({ organizationId, path: "billing" })),
      ).resolves.toBe("guided_onboarding_path_unknown");
      await expect(
        codeOf(callerFor(owner).beginPath({ organizationId, path: "billing" })),
      ).resolves.toBe("guided_onboarding_path_unknown");
      await expect(
        codeOf(
          callerFor(owner).recordPaths({
            organizationId,
            paths: ["llmops", "billing"],
          }),
        ),
      ).resolves.toBe("guided_onboarding_path_unknown");
    });
  });

  describe("when a conversation is attached", () => {
    /** @scenario "attaching a conversation records its id" */
    it("carries the conversation id", async () => {
      const state = await callerFor(owner).attachConversation({
        organizationId,
        conversationId: "conv_1",
      });
      expect(state.conversationId).toBe("conv_1");
    });
  });

  describe("given a user who is not a member of the organization", () => {
    /** @scenario "a member of another organization cannot write the guided state" */
    it("refuses to record paths for it", async () => {
      await expect(
        callerFor(stranger).recordPaths({ organizationId, paths: ["llmops"] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        callerFor(stranger).getGuidedState({ organizationId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
