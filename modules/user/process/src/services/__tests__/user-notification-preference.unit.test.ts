/**
 * The per-person notification choice, over the memory repository.
 * @see specs/langy/langy-notifications.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthApi } from "@langwatch/auth-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import type { UserAvatarStorage } from "../../app/user.members.ts";
import { MemoryUserRepositories } from "../../repositories/memory/memory.user.repositories.ts";
import { UserService } from "../user.service.ts";

const avatarStorage: UserAvatarStorage = { store: async () => ({ id: "object-1" }) };

async function createPerson() {
  const { users } = MemoryUserRepositories.create();
  const service = UserService.create({
    repository: users,
    organizations: createApiFixture<OrganizationApi>({}),
    auth: createApiFixture<AuthApi>({}),
    avatarStorage,
    credentialIssuer: "credential",
  });
  const created = await users.createPasskeyUser({
    email: "ada@acme.com",
    issuer: "credential",
    emailVerified: true,
  });

  return { service, id: created.id };
}

describe("UserService notification preference", () => {
  describe("given a person who never answered the notifications offer", () => {
    /** @scenario "A person who never chose reads no choice" */
    it("reads no choice for the langy topic", async () => {
      const { service, id } = await createPerson();

      await expect(service.getNotificationPreference({ id, topic: "langy" })).resolves.toEqual({
        topic: "langy",
        choice: null,
      });
    });
  });

  describe("given a person who enabled Langy notifications", () => {
    describe("when they turn them off", () => {
      /** @scenario "A stored choice is read back and can be changed" */
      it("reads the choice back as declined", async () => {
        const { service, id } = await createPerson();
        await expect(
          service.setNotificationPreference({ id, topic: "langy", choice: "enabled" }),
        ).resolves.toEqual({ topic: "langy", choice: "enabled" });
        await expect(service.getNotificationPreference({ id, topic: "langy" })).resolves.toEqual({
          topic: "langy",
          choice: "enabled",
        });

        await service.setNotificationPreference({ id, topic: "langy", choice: "declined" });

        await expect(service.getNotificationPreference({ id, topic: "langy" })).resolves.toEqual({
          topic: "langy",
          choice: "declined",
        });
      });
    });
  });

  describe("when a topic this release does not know is asked for", () => {
    it("refuses it at the input", async () => {
      const { service, id } = await createPerson();

      await expect(
        service.getNotificationPreference({ id, topic: "email" as "langy" }),
      ).rejects.toThrow(/topic/);
    });
  });
});
