// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @unit
 * The Postgres twin's owner copy, kept free of an erased owner by the shared marks.
 * Spec: enterprise/modules/nurturing/specs/project-facts-copies.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryNurturingErasedUserRepository } from "../memory.nurturing-erased-user.repository.ts";
import { MemoryNurturingPersonalProjectRepository } from "../memory.nurturing-personal-project.repository.ts";

describe("MemoryNurturingPersonalProjectRepository.recordOwner", () => {
  describe("when an erased owner's fact lands after their erasure", () => {
    /** @scenario "A personal-owner fact landing after the owner's erasure writes no owner row" */
    it("writes no row for them and keeps another owner's", async () => {
      const personalProjects = MemoryNurturingPersonalProjectRepository.create();
      const record = (projectId: string, ownerUserId: string) =>
        personalProjects.recordOwner({ projectId, organizationId: "org-1", ownerUserId });
      await record("project-1", "user-1");
      await personalProjects.forgetOwner({ ownerUserId: "user-1" });

      await record("project-1", "user-1");
      await record("project-2", "user-1");
      await record("project-3", "user-2");

      expect(personalProjects.storedRows()).toEqual([
        { projectId: "project-3", organizationId: "org-1", ownerUserId: "user-2" },
      ]);
    });
  });

  describe("when another copy of the composition marked the owner erased", () => {
    it("writes no row for them: the marks are shared", async () => {
      const erasedUsers = MemoryNurturingErasedUserRepository.create();
      const personalProjects = MemoryNurturingPersonalProjectRepository.create({ erasedUsers });
      await erasedUsers.markErased({ userId: "user-1" });

      await personalProjects.recordOwner({
        projectId: "project-1",
        organizationId: "org-1",
        ownerUserId: "user-1",
      });

      expect(personalProjects.storedRows()).toEqual([]);
    });
  });
});
