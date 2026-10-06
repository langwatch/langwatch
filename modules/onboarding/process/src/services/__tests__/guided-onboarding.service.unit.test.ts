import {
  GuidedOnboardingPathUnknownError,
  type GuidedOnboardingRecord,
} from "@langwatch/onboarding-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
/**
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryPostHogEventsChannel } from "../../channels/memory/memory.posthog-events.channel.ts";
import {
  GuidedOnboardingService,
  type GuidedOnboardingAnnouncer,
} from "../guided-onboarding.service.ts";

function createService(): GuidedOnboardingService {
  return GuidedOnboardingService.create({
    organizations: createApiFixture<OrganizationApi>({}),
    events: MemoryPostHogEventsChannel.create(),
    announce: async () => {},
  });
}

/** The facts the service announces, in order: what the lifecycle pipeline would record. */
function collectAnnouncements(): {
  events: Parameters<GuidedOnboardingAnnouncer>[0][];
  announce: GuidedOnboardingAnnouncer;
} {
  const events: Parameters<GuidedOnboardingAnnouncer>[0][] = [];
  return {
    events,
    announce: async (input) => {
      events.push(input);
    },
  };
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
  /** @scenario "an unknown path is refused before any organization call" */
  it("refuses an unknown path on completePath before touching the organization", async () => {
    const service = createService();

    await expect(
      service.completePath({ organizationId: "org_1", userId: "user_1" }, { path: "billing" }),
    ).rejects.toThrow(GuidedOnboardingPathUnknownError);
  });

  /** @scenario "an unknown path is refused before any organization call" */
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
      announce: async () => {},
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
      announce: async () => {},
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
      announce: async () => {},
    });

    const state = await service.recordProviderSkipped({
      organizationId: "org_1",
      userId: "user_1",
    });

    expect(state.providerSkippedAt).toEqual(expect.any(String));
  });

  /** @scenario "Skip anyway skips the tour as well" */
  it("records the tour as skipped in the same call and announces both skips", async () => {
    const { api, records } = createOrganizations({
      org_1: { state: { paths: [], donePaths: [] }, variant: "guided" },
    });
    const announced = collectAnnouncements();
    const service = GuidedOnboardingService.create({
      organizations: api,
      events: MemoryPostHogEventsChannel.create(),
      announce: announced.announce,
    });

    await service.recordProviderSkipped({ organizationId: "org_1", userId: "user_1" });

    expect(records.get("org_1")?.state).toMatchObject({
      providerSkippedAt: expect.any(String),
      tourSkippedAt: expect.any(String),
    });
    expect(announced.events.map((announcement) => announcement.event)).toEqual([
      "provider_skipped",
      "tour_skipped",
    ]);
    expect(announced.events.every((announcement) => announcement.userId === "user_1")).toBe(true);
  });

  /** @scenario "completing, skipping and replaying the tour are recorded" */
  it("records completing, then skipping, then two replays of the tour", async () => {
    const { api } = createOrganizations({
      org_1: { state: { paths: [], donePaths: [] }, variant: "guided" },
    });
    const service = GuidedOnboardingService.create({
      organizations: api,
      events: MemoryPostHogEventsChannel.create(),
      announce: async () => {},
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
      announce: async () => {},
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
      announce: async () => {},
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
      announce: async () => {},
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
      announce: async () => {},
    });

    const state = await service.attachConversation(
      { organizationId: "org_1", userId: "user_1" },
      { conversationId: "conv_1" },
    );

    expect(state.conversationId).toBe("conv_1");
  });

  /** @scenario "every guided state write reaches the onboarding event hook" */
  /** @scenario "a guided state write reaches PostHog through the service" */
  it("announces a paths_selected fact for the organization and user", async () => {
    const { api } = createOrganizations({
      org_1: { state: { paths: [], donePaths: [] }, variant: "guided" },
    });
    const events = MemoryPostHogEventsChannel.create();
    const announced = collectAnnouncements();
    const service = GuidedOnboardingService.create({
      organizations: api,
      events,
      announce: announced.announce,
    });

    await service.recordPaths(
      { organizationId: "org_1", userId: "user_1" },
      { paths: ["gateway", "llmops"] },
    );

    expect(announced.events).toHaveLength(1);
    expect(announced.events[0]).toMatchObject({
      organizationId: "org_1",
      userId: "user_1",
      event: "paths_selected",
      previousPaths: [],
      state: { paths: ["gateway", "llmops"] },
    });
    expect(events.tracked).toEqual([]);
  });

  /** @scenario "attaching a conversation tracks nothing" */
  it("announces nothing for a conversation attached", async () => {
    const { api } = createOrganizations({
      org_1: { state: { paths: [], donePaths: [] }, variant: "guided" },
    });
    const announced = collectAnnouncements();
    const service = GuidedOnboardingService.create({
      organizations: api,
      events: MemoryPostHogEventsChannel.create(),
      announce: announced.announce,
    });

    await service.attachConversation(
      { organizationId: "org_1", userId: "user_1" },
      { conversationId: "conv_1" },
    );

    expect(announced.events).toEqual([]);
  });
});

describe("GuidedOnboardingService attribution of a write with no user", () => {
  function serviceWithAdministrators(findAdministrators: OrganizationApi["findAdministrators"]) {
    const records = new Map<string, GuidedOnboardingRecord>([
      ["org_1", { state: { paths: [], donePaths: [] }, variant: "guided" }],
    ]);
    const organizations = createApiFixture<OrganizationApi>({
      readGuidedOnboardingState: ({ organizationId }) =>
        Promise.resolve(
          records.get(organizationId) ?? { state: { paths: [], donePaths: [] }, variant: null },
        ),
      writeGuidedOnboardingState: ({ organizationId, record }) => {
        records.set(organizationId, record);
        return Promise.resolve(record);
      },
      findAdministrators,
    });
    const announced = collectAnnouncements();
    const service = GuidedOnboardingService.create({
      organizations,
      events: MemoryPostHogEventsChannel.create(),
      announce: announced.announce,
    });
    return { service, announced, records };
  }

  /** @scenario "a write through a project credential is tracked against the organization admin" */
  it("announces the event against the organization's admin", async () => {
    const { service, announced } = serviceWithAdministrators(() =>
      Promise.resolve([{ userId: "user_admin", name: "Ada", email: "ada@acme.test" }]),
    );

    await service.completePath({ organizationId: "org_1", userId: undefined }, { path: "llmops" });

    expect(announced.events).toHaveLength(1);
    expect(announced.events[0]).toMatchObject({ userId: "user_admin", event: "path_completed" });
  });

  /** @scenario "a write through a project credential of an organization without an admin tracks nothing" */
  it("announces nothing when the organization has no admin", async () => {
    const { service, announced, records } = serviceWithAdministrators(() => Promise.resolve([]));

    await service.completePath({ organizationId: "org_1", userId: undefined }, { path: "llmops" });

    expect(announced.events).toEqual([]);
    expect(records.get("org_1")?.state.donePaths).toEqual(["llmops"]);
  });

  it("keeps the write when the admin lookup fails, and announces nothing", async () => {
    const { service, announced, records } = serviceWithAdministrators(() =>
      Promise.reject(new Error("directory unavailable")),
    );

    await expect(
      service.completePath({ organizationId: "org_1", userId: undefined }, { path: "llmops" }),
    ).resolves.toMatchObject({ donePaths: ["llmops"] });
    expect(announced.events).toEqual([]);
    expect(records.get("org_1")?.state.donePaths).toEqual(["llmops"]);
  });
});
