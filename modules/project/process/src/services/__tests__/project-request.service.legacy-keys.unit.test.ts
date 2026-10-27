import type { ProjectApi } from "@langwatch/project-contract";
/**
 * The organisation-wide legacy key read is judged per project, so a reader keeps
 * the rows of the projects they manage and loses the rest.
 * @see specs/api-keys/api-keys-v2.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { ProjectRequestService } from "../project-request.service.ts";

const ALPHA = {
  projectId: "project_alpha",
  projectName: "Alpha",
  projectSlug: "alpha",
  lastUsedAt: new Date("2026-10-25T12:00:00.000Z"),
};
const BETA = {
  projectId: "project_beta",
  projectName: "Beta",
  projectSlug: "beta",
  lastUsedAt: null,
};

function service({ manageable }: { manageable: readonly string[] }) {
  const findLegacyKeys = vi.fn(async () => [ALPHA, BETA]);
  const probePermission = vi.fn(async (input: { scope: { id: string } }) =>
    manageable.includes(input.scope.id),
  );

  return {
    findLegacyKeys,
    probePermission,
    requests: ProjectRequestService.create({
      projects: createApiFixture<ProjectApi>({}),
      findLegacyKeys,
      probePermission,
    }),
  };
}

describe("ProjectRequestService legacy keys", () => {
  describe("given two projects in the organisation hold a live legacy key", () => {
    it("answers both to a reader who manages both", async () => {
      const { requests } = service({ manageable: ["project_alpha", "project_beta"] });

      const keys = await requests.findLegacyKeys({
        organizationId: "organization_1",
        by: { id: "user_admin" },
      });

      expect(keys.map((key) => key.projectId)).toEqual(["project_alpha", "project_beta"]);
    });

    /** @scenario A reader only sees the legacy rows of the projects they can manage */
    it("drops the row of a project the reader cannot manage", async () => {
      const { requests, probePermission } = service({ manageable: ["project_beta"] });

      const keys = await requests.findLegacyKeys({
        organizationId: "organization_1",
        by: { id: "user_member" },
      });

      expect(keys).toEqual([BETA]);
      expect(probePermission).toHaveBeenCalledWith({
        permission: "project:manage",
        scope: { tier: "project", id: "project_alpha" },
        by: { id: "user_member" },
      });
    });

    /** @scenario A reader who manages no project receives no legacy keys */
    it("answers none to a reader who manages neither", async () => {
      const { requests } = service({ manageable: [] });

      expect(
        await requests.findLegacyKeys({
          organizationId: "organization_1",
          by: { id: "user_outsider" },
        }),
      ).toEqual([]);
    });
  });
});
