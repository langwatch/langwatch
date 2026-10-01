/**
 * @vitest-environment node
 * @see specs/projects/projects-browser-door.feature
 */
import { describe, expect, it } from "vitest";

import { LangyVirtualKeyProvisioningService } from "../langy-virtual-key-provisioning.service.ts";

const REQUEST = { projectId: "project_1", organizationId: "organization-1", actorUserId: "user-1" };

describe("LangyVirtualKeyProvisioningService", () => {
  describe("when the key is minted", () => {
    it("asks the gateway for the project's key on the caller's behalf", async () => {
      const asked: (typeof REQUEST)[] = [];
      const provisioning = LangyVirtualKeyProvisioningService.create({
        virtualKeys: {
          provision: async (input) => {
            asked.push(input);
            return "vk-secret";
          },
        },
      });

      await provisioning.provision(REQUEST);

      expect(asked).toEqual([REQUEST]);
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

      await expect(provisioning.provision(REQUEST)).resolves.toBeUndefined();
    });
  });
});
