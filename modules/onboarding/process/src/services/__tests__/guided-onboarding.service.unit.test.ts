/**
 * @scenario "an unknown path is refused before any organization call"
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  GuidedOnboardingPathUnknownError,
  type GuidedOnboardingRecord,
} from "@langwatch/onboarding-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { MemoryPostHogEventsChannel } from "../../channels/memory/memory.posthog-events.channel.ts";
import { GuidedOnboardingService } from "../guided-onboarding.service.ts";

function createService(): GuidedOnboardingService {
  return GuidedOnboardingService.create({
    organizations: createApiFixture<OrganizationApi>({}),
    events: MemoryPostHogEventsChannel.create(),
  });
}

/**
 * A real read/write pair over an in-memory record per organization — the
 * shape `readGuidedOnboardingState`/`writeGuidedOnboardingState` answer in
 * `modules/organization/process`, doubled rather than mocked.
 */
function createOrganizations(seed: Readonly<Record<string, GuidedOnboardingRecord>> = {}): {
  api: OrganizationApi;
  records: Map<string, GuidedOnboardingRecord>;
} {
  const records = new Map(Object.entries(seed));
  const api = createApiFixture<OrganizationApi>({
    readGuidedOnboardingState: ({ organizationId }) =>
      Promise.resolve(
        records.get(organizationId) ?? { state: { paths: [], donePaths: [] }, variant: null },
      ),
    writeGuidedOnboardingState: ({ organizationId, record }) => {
      records.set(organizationId, record);
      return Promise.resolve(record);
    },
  });
  return { api, records };
}

describe("GuidedOnboardingService path guards", () => {
  it("refuses an unknown path on completePath before touching the organization", async () => {
    const service = createService();

    await expect(
      service.completePath({ organizationId: "org_1", userId: "user_1" }, { path: "billing" }),
    ).rejects.toThrow(GuidedOnboardingPathUnknownError);
  });

  it("refuses an unknown path on beginPath before touching the organization", async () => {
    const service = createService();

    await expect(
      service.beginPath({ organizationId: "org_1", userId: "user_1" }, { path: "billing" }),
    ).rejects.toThrow(GuidedOnboardingPathUnknownError);
  });

  it("refuses an unknown path in recordPaths before touching the organization", async () => {
    const service = createService();

    await expect(
      service.recordPaths({ organizationId: "org_1", userId: "user_1" }, { paths: ["billing"] }),
    ).rejects.toThrow(GuidedOnboardingPathUnknownError);
  });

  /** @scenario "an unknown path is rejected with a named error" */
  it("rejects completePath with the named code for an organization already in the guided variant", async () => {
    const { api } = createOrganizations({
      org_1: { state: { paths: ["llmops"], donePaths: [] }, variant: "guided" },
    });
    const service = GuidedOnboardingService.create({
      organizations: api,
      events: MemoryPostHogEventsChannel.create(),
    });

    const failure = await service
      .completePath({ organizationId: "org_1", userId: "user_1" }, { path: "billing" })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(GuidedOnboardingPathUnknownError);
    expect((failure as GuidedOnboardingPathUnknownError).code).toBe(
      "guided_onboarding_path_unknown",
    );
  });
});

describe("GuidedOnboardingService over a real organization read/write", () => {
  /** @scenario "recording a provider stores the provider and its model" */
  it("stores the provider and its model", async () => {
    const { api } = createOrganizations({
      org_1: { state: { paths: [], donePaths: [] }, variant: "guided" },
    });
    const service = GuidedOnboardingService.create({
      organizations: api,
      events: MemoryPostHogEventsChannel.create(),
    });

    const state = await service.recordProvider(
      { organizationId: "org_1", userId: "user_1" },
      { provider: "openai", model: "gpt-5" },
    );

    expect(state.provider).toBe("openai");
    expect(state.providerModel).toBe("gpt-5");
  });

  /** @scenario "skipping the provider is recorded" */
  it("records the time the provider step was skipped", async () => {
    const { api } = createOrganizations({
      org_1: { state: { paths: [], donePaths: [] }, variant: "guided" },
    });
    const service = GuidedOnboardingService.create({
      organizations: api,
      events: MemoryPostHogEventsChannel.create(),
    });

    const state = await service.recordProviderSkipped({
      organizationId: "org_1",
      userId: "user_1",
    });

    expect(state.providerSkippedAt).toEqual(expect.any(String));
  });

  /** @scenario "completing, skipping and replaying the tour are recorded" */
  it("records completing, then skipping, then two replays of the tour", async () => {
    const { api } = createOrganizations({
      org_1: { state: { paths: [], donePaths: [] }, variant: "guided" },
    });
    const service = GuidedOnboardingService.create({
      organizations: api,
      events: MemoryPostHogEventsChannel.create(),
    });
    const actor = { organizationId: "org_1", userId: "user_1" };

    const completed = await service.recordTour(actor, { status: "completed" });
    expect(completed.tourCompletedAt).toEqual(expect.any(String));

    const skipped = await service.recordTour(actor, { status: "skipped" });
    expect(skipped.tourSkippedAt).toEqual(expect.any(String));

    await service.recordTour(actor, { status: "replayed" });
    const twice = await service.recordTour(actor, { status: "replayed" });
    expect(twice.tourReplays).toBe(2);
  });

  /** @scenario "beginning a path the user never picked appends it to the picked paths" */
  it("appends an unpicked path and makes it current", async () => {
    const { api } = createOrganizations({
      org_1: { state: { paths: ["llmops"], donePaths: [] }, variant: "guided" },
    });
    const service = GuidedOnboardingService.create({
      organizations: api,
      events: MemoryPostHogEventsChannel.create(),
    });

    const state = await service.beginPath(
      { organizationId: "org_1", userId: "user_1" },
      { path: "governance" },
    );

    expect(state.currentPath).toBe("governance");
    expect(state.paths).toEqual(["llmops", "governance"]);
  });

  /** @scenario "beginning a path the user already picked keeps the picked paths as they are" */
  it("keeps the picked paths as they are for a path already picked", async () => {
    const { api } = createOrganizations({
      org_1: { state: { paths: ["gateway", "llmops"], donePaths: [] }, variant: "guided" },
    });
    const service = GuidedOnboardingService.create({
      organizations: api,
      events: MemoryPostHogEventsChannel.create(),
    });

    const state = await service.beginPath(
      { organizationId: "org_1", userId: "user_1" },
      { path: "llmops" },
    );

    expect(state.currentPath).toBe("llmops");
    expect(state.paths).toEqual(["gateway", "llmops"]);
  });

  /** @scenario "completing a path is idempotent" */
  it("changes nothing on a second completion of the same path", async () => {
    const { api } = createOrganizations({
      org_1: {
        state: { paths: ["llmops"], currentPath: "llmops", donePaths: [] },
        variant: "guided",
      },
    });
    const service = GuidedOnboardingService.create({
      organizations: api,
      events: MemoryPostHogEventsChannel.create(),
    });
    const actor = { organizationId: "org_1", userId: "user_1" };

    await service.completePath(actor, { path: "llmops" });
    const state = await service.completePath(actor, { path: "llmops" });

    expect(state.donePaths).toEqual(["llmops"]);
    expect(state.currentPath).toBeUndefined();
  });

  /** @scenario "attaching a conversation records its id" */
  it("records the attached conversation id", async () => {
    const { api } = createOrganizations({
      org_1: { state: { paths: [], donePaths: [] }, variant: "guided" },
    });
    const service = GuidedOnboardingService.create({
      organizations: api,
      events: MemoryPostHogEventsChannel.create(),
    });

    const state = await service.attachConversation(
      { organizationId: "org_1", userId: "user_1" },
      { conversationId: "conv_1" },
    );

    expect(state.conversationId).toBe("conv_1");
  });

  /** @scenario "every guided state write reaches the onboarding event hook" */
  it("tracks a paths_selected event for the organization and user", async () => {
    const { api } = createOrganizations({
      org_1: { state: { paths: [], donePaths: [] }, variant: "guided" },
    });
    const events = MemoryPostHogEventsChannel.create();
    const service = GuidedOnboardingService.create({ organizations: api, events });

    await service.recordPaths(
      { organizationId: "org_1", userId: "user_1" },
      { paths: ["gateway", "llmops"] },
    );

    expect(events.tracked).toHaveLength(1);
    expect(events.tracked[0]).toMatchObject({
      userId: "user_1",
      event: "guided_onboarding_paths_selected",
      properties: expect.objectContaining({ organization_id: "org_1" }),
    });
  });
});
