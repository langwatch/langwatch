/**
 * @vitest-environment node
 * The `/api/me/project` door: the calling key's project, read through project's share (R40).
 * @see modules/user/specs/user.feature
 */
import { InMemoryProcessStore } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { MemoryUserOrganizationDirectoryRepository } from "../../repositories/memory/memory.user-organization-directory.repository.ts";
import { MemoryUserRepositories } from "../../repositories/memory/memory.user.repositories.ts";
import { createUserTestApp } from "./user.fixture.ts";

const PROJECT = { id: "project-1", name: "Checkout", slug: "checkout", isPersonal: false };

function keyProjectApp() {
  return createUserTestApp({
    repositories: {
      ...MemoryUserRepositories.create({ processStore: InMemoryProcessStore.createForTesting() }),
      organizationDirectory: MemoryUserOrganizationDirectoryRepository.create({
        "organization-1": { projects: [PROJECT] },
      }),
    },
  });
}

describe("the key's project door", () => {
  describe("when the key's project exists", () => {
    /** @scenario "The key's project door names the project from project's own table" */
    it("answers its id, name, slug and whether it is personal", async () => {
      expect(await keyProjectApp().getKeyProject({ projectId: PROJECT.id })).toEqual(PROJECT);
    });
  });

  describe("when the key's project row is gone", () => {
    /** @scenario "The key's project door refuses a key whose project row is gone" */
    it("refuses and names no project", async () => {
      await expect(keyProjectApp().getKeyProject({ projectId: "gone" })).rejects.toThrow(
        'no project row for the credential\'s project "gone"',
      );
    });
  });
});
