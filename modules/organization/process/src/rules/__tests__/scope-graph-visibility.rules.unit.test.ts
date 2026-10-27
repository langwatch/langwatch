import type { ScopeGraphOrganization, ScopeGraphProject } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import { narrowScopeGraphToViewer } from "../scope-graph-visibility.rules.ts";

const userId = "user-sam";

function projectOf({ id, kind }: { id: string; kind: string }): ScopeGraphProject {
  return {
    id,
    slug: id,
    name: id,
    kind,
    userLinkTemplate: null,
    presenceEnabled: false,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
  };
}

function organizationAs({ role }: { role: string }): ScopeGraphOrganization {
  return {
    id: "org-1",
    slug: "org-1",
    name: "Org",
    primaryIntent: null,
    presenceEnabled: false,
    pricingModel: "TIERED",
    ssoProvider: null,
    members: [{ role }],
    teams: [
      {
        id: "team-1",
        slug: "team-1",
        name: "Team",
        isPersonal: false,
        ownerUserId: null,
        personalOf: null,
        members: [{ userId }],
        projects: [
          projectOf({ id: "app", kind: "application" }),
          projectOf({ id: "aggregate", kind: "aggregate" }),
        ],
      },
    ],
  };
}

function projectIdsFor({ role }: { role: string }): string[] {
  const narrowed = narrowScopeGraphToViewer({
    organization: organizationAs({ role }),
    userId,
    bindings: [],
  });
  return narrowed.teams.flatMap((team) => team.projects.map((project) => project.id));
}

describe("narrowScopeGraphToViewer()", () => {
  describe("when the caller is not an organisation admin", () => {
    it("leaves the aggregate project out of a team they belong to", () => {
      expect(projectIdsFor({ role: "MEMBER" })).toEqual(["app"]);
      expect(projectIdsFor({ role: "EXTERNAL" })).toEqual(["app"]);
    });
  });

  describe("when the caller is an organisation admin", () => {
    it("keeps the aggregate project", () => {
      expect(projectIdsFor({ role: "ADMIN" })).toEqual(["app", "aggregate"]);
    });
  });
});
