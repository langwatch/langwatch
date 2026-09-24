import { createApiFixture } from "@langwatch/api-fixture";
import type { RestResolvedProjectCredential } from "@langwatch/api/rest";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
/**
 * @see specs/langy/langy-api-key-turns.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { LangyActorUserReader } from "../langy-actor-session.service.ts";
import { LangyRestCallerService } from "../langy-rest-caller.service.ts";

const credential: RestResolvedProjectCredential = {
  type: "apiKey",
  apiKeyId: "key-1",
  userId: "user-1",
  organizationId: "org-1",
  ingestSourceType: null,
  ingestionTemplateId: null,
  project: {
    id: "project-1",
    name: "Project",
    slug: "project",
    teamId: "team-1",
    organizationId: "org-1",
    isPersonal: false,
    ownerUserId: null,
  },
};

function actors(found: boolean): LangyActorUserReader {
  return {
    user: {
      findUnique: async () => (found ? { id: "user-1", name: "Ada", email: "ada@x.test" } : null),
    },
  };
}

function build(options: { enabled: boolean; found?: boolean }) {
  const isEnabled = vi.fn(async () => options.enabled);
  const service = LangyRestCallerService.create({
    featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled }, "langy rest flags"),
    actors: actors(options.found ?? true),
  });
  return { service, isEnabled };
}

describe("LangyRestCallerService", () => {
  describe("when the surface's rollout is off for the project", () => {
    it("answers dark before the key's owner is asked about", async () => {
      const { service, isEnabled } = build({ enabled: false });

      const caller = await service.getCaller({ credential, surface: "turns" });

      expect(caller).toEqual({ dark: true });
      expect(isEnabled).toHaveBeenCalledTimes(1);
      expect(isEnabled).toHaveBeenCalledWith("release_langy_api_key_turns_enabled", {
        kind: "project",
        projectId: "project-1",
        organizationId: "org-1",
      });
    });
  });

  describe("when the rollout is on and the owner has Langy access", () => {
    it("answers the project and the key's owner", async () => {
      const { service } = build({ enabled: true });

      const caller = await service.getCaller({ credential, surface: "ui_actions" });

      expect(caller).toEqual({ dark: false, projectId: "project-1", userId: "user-1" });
    });
  });

  describe("when the key is owned by no user", () => {
    it("refuses with the unowned code", async () => {
      const { service } = build({ enabled: true });

      await expect(
        service.getLocalCaller({ credential: { ...credential, userId: null } }),
      ).rejects.toMatchObject({ code: "langy_api_key_unowned" });
    });
  });

  describe("when a local worker's key belongs to a user with Langy access", () => {
    it("answers the owner with the project facts its links name", async () => {
      const { service } = build({ enabled: true });

      const caller = await service.getLocalCaller({ credential });

      expect(caller).toEqual({
        userId: "user-1",
        projectId: "project-1",
        projectName: "Project",
        projectSlug: "project",
      });
    });
  });

  describe("when the key's owning user no longer exists", () => {
    it("refuses with the missing-actor code", async () => {
      const { service } = build({ enabled: true, found: false });

      await expect(service.getActor({ userId: "user-1" })).rejects.toMatchObject({
        code: "langy_api_actor_missing",
      });
    });
  });
});
