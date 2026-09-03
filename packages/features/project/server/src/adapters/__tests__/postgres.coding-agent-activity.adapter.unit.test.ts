import { describe, expect, it, vi } from "vitest";
import { ProjectNotFoundError } from "@langwatch/project-contract";
import { PostgresCodingAgentActivityAdapter } from "../postgres.coding-agent-activity.adapter";

/**
 * The staleness window `ProjectService` applies to both activity columns.
 *
 * Restated here rather than imported: the point of these cases is that this
 * seam applies the App's window without reaching into the App's service, and
 * an import would assert the constant against itself.
 */
const CODING_AGENT_ACTIVITY_TOUCH_MS = 60 * 60 * 1000;

const AT = new Date("2026-09-02T04:00:00.000Z");
const STALE_BEFORE = new Date(AT.getTime() - CODING_AGENT_ACTIVITY_TOUCH_MS);

function compose(
  overrides: {
    findUnique?: () => Promise<unknown>;
  } = {},
) {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const findUnique = vi.fn(
    overrides.findUnique ?? (async () => ({ team: { organizationId: "organization_acme" } })),
  );
  const activity = PostgresCodingAgentActivityAdapter.create({
    database: { project: { updateMany, findUnique } } as never,
  }).build();

  return { activity, updateMany, findUnique };
}

describe("PostgresCodingAgentActivityAdapter", () => {
  describe("when a folded session records activity on a project", () => {
    /** @scenario "An active project is stamped when its activity is stale" */
    it("updates only an active project whose stamp is older than the touch window", async () => {
      const { activity, updateMany } = compose();

      await activity.touchCodingAgentSessionSeen({ projectId: "project_alpha", at: AT });

      // Frozen twin of `PrismaProjectRepository.touchCodingAgentSessionSeen`
      // under `ProjectService`'s own hour. The predicate is the throttle: it
      // is what keeps a busy fleet's session folds off Postgres, and a graph
      // that dropped it would write on every fold.
      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id: "project_alpha",
          archivedAt: null,
          OR: [
            { lastCodingAgentSessionAt: null },
            { lastCodingAgentSessionAt: { lte: STALE_BEFORE } },
          ],
        },
        data: { lastCodingAgentSessionAt: AT },
      });
    });

    /** @scenario "A freshly stamped project is not written again" */
    it("leaves the throttle to the predicate rather than reading first", async () => {
      const { activity, updateMany, findUnique } = compose();

      await activity.touchCodingAgentSessionSeen({ projectId: "project_alpha", at: AT });

      // One statement, no read-then-write: a project stamped inside the window
      // simply matches no row. Two graphs racing on a read would both decide
      // the stamp was due.
      expect(updateMany).toHaveBeenCalledTimes(1);
      expect(findUnique).not.toHaveBeenCalled();
    });
  });

  describe("when a mapping run links a pull request to a project", () => {
    /** @scenario "A mapped pull request stamps its own column" */
    it("stamps the pull-request column and leaves the session column alone", async () => {
      const { activity, updateMany } = compose();

      await activity.touchCodingAgentPullRequestSeen({ projectId: "project_alpha", at: AT });

      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id: "project_alpha",
          archivedAt: null,
          OR: [
            { lastCodingAgentPullRequestAt: null },
            { lastCodingAgentPullRequestAt: { lte: STALE_BEFORE } },
          ],
        },
        data: { lastCodingAgentPullRequestAt: AT },
      });
    });
  });

  describe("when branch demand asks which organization a tenant belongs to", () => {
    /** @scenario "The organization is resolved through the project's team" */
    it("answers the team's organization, reading only an active project", async () => {
      const { activity, findUnique } = compose();

      await expect(activity.getOrganizationId("project_alpha")).resolves.toBe("organization_acme");
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "project_alpha", archivedAt: null },
        select: { team: { select: { organizationId: true } } },
      });
    });

    /** @scenario "An unknown or archived project has no organization" */
    it("fails the way the App's own read fails when there is no active project", async () => {
      const { activity } = compose({ findUnique: async () => null });

      // `ProjectService.getOrganizationId` reads through `getWithTeam`, whose
      // query carries `archivedAt: null` and whose miss is this error. Branch
      // demand catches it and declines to map, so answering anything else
      // here would map a branch for the wrong organization.
      await expect(activity.getOrganizationId("project_alpha")).rejects.toBeInstanceOf(
        ProjectNotFoundError,
      );
    });
  });
});
