/**
 * What the first-login backfill tells Customer.io.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { Temporal } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureUserSynced,
  resetUserSyncCache,
  userSyncCacheSize,
} from "../../rules/nurturing-user-sync-service.rules.ts";
import {
  registerFailingProfileReader,
  registerNoNurturingSink,
  registerNoProfileReader,
  registerNurturingSink,
  registerProfileReader,
  settle,
} from "./support/nurturing-harness.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const PROFILE = {
  user: {
    id: "user-1",
    email: "jane@example.com",
    name: "Jane Doe",
    createdAt: Temporal.Instant.from("2025-01-15T10:00:00Z"),
  },
  organization: {
    id: "org-1",
    name: "Acme Corp",
    signupData: {},
  },
  hasTraces: true,
  hasSubscription: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetUserSyncCache();
});
afterEach(() => {
  registerNoNurturingSink();
  registerNoProfileReader();
});

describe("ensureUserSynced()", () => {
  describe("given a user who has not been synced this process lifetime", () => {
    /** @scenario the first login backfill sends the full identify call */
    it("sends the full identify call with email, name and adoption traits", async () => {
      const sink = registerNurturingSink();
      registerProfileReader(PROFILE);

      ensureUserSynced({ userId: "user-1", hasOrganization: true });
      await settle();

      expect(sink.sentTo("/identify")[0]).toMatchObject({
        userId: "user-1",
        traits: {
          email: "jane@example.com",
          name: "Jane Doe",
          has_traces: true,
          has_subscription: false,
          createdAt: "2025-01-15T10:00:00Z",
        },
      });
    });

    it("sends the group call to associate the user with its organization", async () => {
      const sink = registerNurturingSink();
      registerProfileReader(PROFILE);

      ensureUserSynced({ userId: "user-1", hasOrganization: true });
      await settle();

      expect(sink.sentTo("/group")[0]).toMatchObject({
        userId: "user-1",
        groupId: "org-1",
        traits: { name: "Acme Corp" },
      });
    });

    it("adds the user to the sync cache", async () => {
      registerNurturingSink();
      registerProfileReader(PROFILE);

      ensureUserSynced({ userId: "user-1", hasOrganization: true });
      await settle();

      expect(userSyncCacheSize()).toBe(1);
    });
  });

  describe("given a user who has already been synced this process lifetime", () => {
    /** @scenario a second login within the process lifetime skips the sync entirely */
    it("skips the profile read and the Customer.io calls on the second call", async () => {
      const sink = registerNurturingSink();
      registerProfileReader(PROFILE);

      ensureUserSynced({ userId: "user-1", hasOrganization: true });
      await settle();
      expect(sink.sentTo("/identify")).toHaveLength(1);

      registerProfileReader(PROFILE);
      ensureUserSynced({ userId: "user-1", hasOrganization: true });
      await settle();

      expect(sink.sentTo("/identify")).toHaveLength(1);
    });
  });

  describe("given a user without an organization", () => {
    it("skips entirely to avoid creating ghost Customer.io profiles", async () => {
      const sink = registerNurturingSink();
      registerProfileReader(PROFILE);

      ensureUserSynced({ userId: "user-1", hasOrganization: false });
      await settle();

      expect(sink.sent()).toHaveLength(0);
      expect(userSyncCacheSize()).toBe(0);
    });
  });

  describe("given no Customer.io sink is configured", () => {
    it("skips silently and never adds the user to the sync cache", async () => {
      registerNoNurturingSink();
      registerProfileReader(PROFILE);

      ensureUserSynced({ userId: "user-1", hasOrganization: true });
      await settle();

      expect(userSyncCacheSize()).toBe(0);
    });
  });

  describe("given the profile reader has nothing for this user", () => {
    /** @scenario a user the reader cannot find sends no Customer.io call */
    it("sends no identify or group call", async () => {
      const sink = registerNurturingSink();
      registerProfileReader(null);

      ensureUserSynced({ userId: "user-1", hasOrganization: true });
      await settle();

      expect(sink.sent()).toHaveLength(0);
    });

    it("keeps the user in the sync cache (optimistic lock, cleared on restart)", async () => {
      registerNurturingSink();
      registerProfileReader(null);

      ensureUserSynced({ userId: "user-1", hasOrganization: true });
      await settle();

      expect(userSyncCacheSize()).toBe(1);
    });
  });

  describe("given the profile read fails", () => {
    /** @scenario a profile-read failure never throws and clears the cache for a retry */
    it("does not throw and clears the sync cache so the next login can retry", async () => {
      registerNurturingSink();
      registerFailingProfileReader(new Error("reader unreachable"));

      expect(() => ensureUserSynced({ userId: "user-1", hasOrganization: true })).not.toThrow();
      await settle();

      expect(userSyncCacheSize()).toBe(0);
    });
  });

  describe("given a user with no traces", () => {
    it("sends has_traces as false", async () => {
      const sink = registerNurturingSink();
      registerProfileReader({ ...PROFILE, hasTraces: false });

      ensureUserSynced({ userId: "user-1", hasOrganization: true });
      await settle();

      expect(sink.sentTo("/identify")[0]).toMatchObject({ traits: { has_traces: false } });
    });
  });

  describe("given a user whose organization went through the guided onboarding", () => {
    const guidedProfile = {
      ...PROFILE,
      organization: {
        ...PROFILE.organization,
        signupData: {
          onboardingVariant: "guided",
          guidedOnboarding: {
            paths: ["gateway", "llmops"],
            currentPath: "llmops",
            donePaths: ["gateway"],
            provider: "openai",
            tourCompletedAt: "2026-09-05T10:00:00.000Z",
          },
        },
      },
    };

    /** @scenario the first login backfill carries the onboarding traits */
    it("carries the onboarding traits on the identify call and the organization group", async () => {
      const sink = registerNurturingSink();
      registerProfileReader(guidedProfile);

      ensureUserSynced({ userId: "user-1", hasOrganization: true });
      await settle();

      expect(sink.sentTo("/identify")[0]).toMatchObject({
        traits: {
          onboarding_variant: "guided",
          onboarding_paths: "gateway,llmops",
          onboarding_primary_path: "gateway",
          guided_onboarding_provider: "openai",
          guided_onboarding_tour: "completed",
          guided_onboarding_completed_paths: "gateway",
        },
      });
      expect(sink.sentTo("/group")[0]).toMatchObject({
        traits: {
          onboarding_variant: "guided",
          onboarding_paths: "gateway,llmops",
          onboarding_primary_path: "gateway",
          guided_onboarding_completed_paths: "gateway",
        },
      });
    });
  });

  describe("given a user whose organization recorded no onboarding variant", () => {
    /** @scenario the first login backfill of an organization that predates the experiment carries no onboarding traits */
    it("carries no onboarding trait", async () => {
      const sink = registerNurturingSink();
      registerProfileReader(PROFILE);

      ensureUserSynced({ userId: "user-1", hasOrganization: true });
      await settle();

      const traits = sink.sentTo("/identify")[0]!;
      expect(Object.keys(traits).filter((key) => key.includes("onboarding"))).toEqual([]);
      const orgTraits = sink.sentTo("/group")[0]!;
      expect(Object.keys(orgTraits).filter((key) => key.includes("onboarding"))).toEqual([]);
    });
  });
});
