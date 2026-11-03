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
  teamId: "team_alpha",
  projectName: "Alpha",
  projectSlug: "alpha",
  lastUsedAt: new Date("2026-10-25T12:00:00.000Z"),
};
const BETA = {
  projectId: "project_beta",
  teamId: "team_beta",
  projectName: "Beta",
  projectSlug: "beta",
  lastUsedAt: null,
};

/** The same key as the browser receives it: the owning team is a decision detail. */
function onTheWire({
  projectId,
  projectName,
  projectSlug,
  lastUsedAt,
}: typeof ALPHA | typeof BETA) {
  return { projectId, projectName, projectSlug, lastUsedAt };
}

function service({ manageable }: { manageable: readonly string[] }) {
  const findLegacyKeys = vi.fn(async () => [ALPHA, BETA]);
  const decideManageable = vi.fn(
    async (input: { projects: readonly Readonly<{ projectId: string }>[] }) =>
      new Map(
        input.projects.map(({ projectId }) => [projectId, manageable.includes(projectId)] as const),
      ),
  );
  const probePermission = vi.fn(async () => false);

  return {
    findLegacyKeys,
    decideManageable,
    requests: ProjectRequestService.create({
      projects: createApiFixture<ProjectApi>({}),
      findLegacyKeys,
      decideManageable,
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
      const { requests, decideManageable } = service({ manageable: ["project_beta"] });

      const keys = await requests.findLegacyKeys({
        organizationId: "organization_1",
        by: { id: "user_member" },
      });

      expect(keys).toEqual([onTheWire(BETA)]);
      expect(decideManageable).toHaveBeenCalledWith({
        organizationId: "organization_1",
        projects: [
          { projectId: "project_alpha", teamId: "team_alpha" },
          { projectId: "project_beta", teamId: "team_beta" },
        ],
        by: { id: "user_member" },
      });
    });

    it("names each project's team so the decision needs no lineage read", async () => {
      const { requests, decideManageable } = service({ manageable: ["project_alpha"] });

      await requests.findLegacyKeys({
        organizationId: "organization_1",
        by: { id: "user_member" },
      });

      const [call] = decideManageable.mock.calls;
      expect(call?.[0].projects.every((project) => "teamId" in project)).toBe(true);
    });

    it("keeps the owning team out of the answer", async () => {
      const { requests } = service({ manageable: ["project_alpha", "project_beta"] });

      const keys = await requests.findLegacyKeys({
        organizationId: "organization_1",
        by: { id: "user_admin" },
      });

      expect(keys.every((key) => !("teamId" in key))).toBe(true);
    });

    it("asks for one decision, not one per project", async () => {
      const { requests, decideManageable } = service({ manageable: ["project_alpha"] });

      await requests.findLegacyKeys({
        organizationId: "organization_1",
        by: { id: "user_member" },
      });

      expect(decideManageable).toHaveBeenCalledTimes(1);
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
