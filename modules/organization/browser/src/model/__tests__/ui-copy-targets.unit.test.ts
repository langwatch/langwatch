/**
 * Which projects a reader could replicate into.
 * Spec: specs/evaluations/evaluation-pages.feature
 */

import type { UiScopeOrganization } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { uiCopyCandidates, uiCopyTargets } from "../ui-copy-targets";

const PERMISSION = "evaluations:manage";

const organizations = (teams: UiScopeOrganization["teams"]): UiScopeOrganization[] => [
  { id: "org_1", name: "Acme", teams },
];

const GRAPH = organizations([
  {
    id: "team_1",
    slug: "engineering",
    name: "Engineering",
    members: [{ userId: "user_1" }],
    projects: [{ id: "proj_1", slug: "web-app", name: "Web App" }],
  },
  {
    id: "team_2",
    slug: "support",
    name: "Support",
    members: [{ userId: "user_1" }],
    projects: [{ id: "proj_2", slug: "helpdesk", name: "Helpdesk" }],
  },
  {
    id: "team_3",
    slug: "finance",
    name: "Finance",
    members: [{ userId: "someone_else" }],
    projects: [{ id: "proj_3", slug: "billing", name: "Billing" }],
  },
]);

const GRANTS: Readonly<Record<string, readonly string[]>> = {
  proj_1: ["evaluations:manage"],
  proj_2: ["evaluations:view"],
};

describe("given a reader who may manage evaluations in one project and only view them in another", () => {
  describe("when the replication targets are derived", () => {
    /** @scenario "A replication target I cannot create in is listed rather than hidden" */
    it("lists both, and marks the one they may not create in as closed", () => {
      const targets = uiCopyTargets({
        candidates: uiCopyCandidates({ organizations: GRAPH, userId: "user_1" }),
        grantsOf: (projectId) => GRANTS[projectId],
        permission: PERMISSION,
      });

      expect(targets).toEqual([
        {
          projectId: "proj_1",
          projectSlug: "web-app",
          label: "Acme / Engineering / Web App",
          mayCreate: true,
        },
        {
          projectId: "proj_2",
          projectSlug: "helpdesk",
          label: "Acme / Support / Helpdesk",
          mayCreate: false,
        },
      ]);
    });

    /** @scenario "A replication target I cannot create in is listed rather than hidden" */
    it("reads a project whose grants have not landed as closed", () => {
      const targets = uiCopyTargets({
        candidates: uiCopyCandidates({ organizations: GRAPH, userId: "user_1" }),
        grantsOf: () => void 0,
        permission: PERMISSION,
      });

      expect(targets.map((target) => target.mayCreate)).toEqual([false, false]);
    });
  });
});

describe("given a team the reader holds no membership row in", () => {
  describe("when the replication targets are derived", () => {
    /** @scenario "A team I am not a member of contributes no replication targets" */
    it("contributes none of that team's projects at all", () => {
      const candidates = uiCopyCandidates({ organizations: GRAPH, userId: "user_1" });

      expect(candidates.map((candidate) => candidate.projectId)).not.toContain("proj_3");
    });
  });
});

describe("given nobody signed in", () => {
  describe("when the replication targets are derived", () => {
    /** @scenario "A team I am not a member of contributes no replication targets" */
    it("offers nothing rather than every project in the graph", () => {
      expect(uiCopyCandidates({ organizations: GRAPH, userId: void 0 })).toEqual([]);
    });
  });
});
