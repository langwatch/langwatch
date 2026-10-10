/**
 * @vitest-environment node
 * @see specs/projects/projects-browser-door.feature
 */
import type { ProjectCreatedEventData } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { LangyVirtualKeyProvisioningService } from "../langy-virtual-key-provisioning.service.ts";

const CREATED: ProjectCreatedEventData = {
  tenantId: "project_1",
  projectId: "project_1",
  organizationId: "organization-1",
  occurredAt: 0,
  createdByUserId: "user-1",
};

type Minted = { projectId: string; organizationId: string; actorUserId: string };

function recording(asked: Minted[]) {
  return LangyVirtualKeyProvisioningService.create({
    virtualKeys: {
      provision: async (input) => {
        asked.push(input);
        return "vk-secret";
      },
    },
  });
}

describe("LangyVirtualKeyProvisioningService", () => {
  describe("when project records a project somebody created", () => {
    /** @scenario "creating a project provisions Langy's virtual key from Langy's side" */
    it("asks the gateway for the project's key on the creator's behalf", async () => {
      const asked: Minted[] = [];

      await recording(asked).provisionCreated(CREATED);

      expect(asked).toEqual([
        { projectId: "project_1", organizationId: "organization-1", actorUserId: "user-1" },
      ]);
    });
  });

  describe("when the project had no creator or was backfilled", () => {
    /** @scenario "a project with no creator or recorded by a backfill gets no Langy key on creation" */
    it("mints nothing", async () => {
      const asked: Minted[] = [];
      const provisioning = recording(asked);

      await provisioning.provisionCreated({ ...CREATED, createdByUserId: null });
      await provisioning.provisionCreated({ ...CREATED, backfilled: true });

      expect(asked).toEqual([]);
    });
  });

  describe("when the key cannot be minted", () => {
    /** @scenario "a Langy key that cannot be minted does not fail the project's creation" */
    it("answers normally", async () => {
      const provisioning = LangyVirtualKeyProvisioningService.create({
        virtualKeys: {
          provision: async () => {
            throw new Error("gateway unreachable");
          },
        },
      });

      await expect(provisioning.provisionCreated(CREATED)).resolves.toBeUndefined();
    });
  });
});
