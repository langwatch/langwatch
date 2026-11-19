import { describe, expect, it } from "vitest";

import { scopesFromGraph } from "../model-provider-host-mount.tsx";

const organizations = [
  { id: "org-other", name: "Other", teams: [] },
  {
    id: "org-1",
    name: "Acme",
    teams: [
      { id: "team-a", name: "Alpha", projects: [{ id: "p-1", name: "One" }] },
      {
        id: "team-b",
        name: "Beta",
        projects: [
          { id: "p-2", name: "Two" },
          { id: "p-3", name: "Three" },
        ],
      },
    ],
  },
];

describe("scopesFromGraph", () => {
  describe("when the active organization is in the graph", () => {
    /** @scenario Model provider pickers list project names without a team suffix */
    it("offers every team and project the reader reaches, by their plain names", () => {
      expect(
        scopesFromGraph({ organizations, organizationId: "org-1", viewerUserId: "u-1" }),
      ).toEqual({
        organization: { id: "org-1", name: "Acme" },
        teams: [
          { id: "team-a", name: "Alpha" },
          { id: "team-b", name: "Beta" },
        ],
        projects: [
          { id: "p-1", name: "One", teamId: "team-a" },
          { id: "p-2", name: "Two", teamId: "team-b" },
          { id: "p-3", name: "Three", teamId: "team-b" },
        ],
      });
    });
  });

  describe("when the graph has not loaded or lacks the organization", () => {
    it("returns null so the host falls back to the current scope", () => {
      expect(
        scopesFromGraph({ organizations: [], organizationId: "org-1", viewerUserId: "u-1" }),
      ).toBeNull();
      expect(
        scopesFromGraph({ organizations, organizationId: undefined, viewerUserId: "u-1" }),
      ).toBeNull();
    });
  });

  describe("when the reader sees two personal workspaces", () => {
    /** @scenario A personal workspace names its owner, and the reader's own says "(you)" */
    it("hints each personal project with its owner, the reader's own with (you)", () => {
      const scopes = scopesFromGraph({
        organizations: [
          {
            id: "org-1",
            name: "Acme",
            teams: [
              {
                id: "t-alex",
                name: "Alex Rivera's Workspace",
                isPersonal: true,
                ownerUserId: "u-alex",
                projects: [{ id: "p-alex", name: "Personal Workspace" }],
              },
              {
                id: "t-sam",
                name: "Sam Lee's Workspace",
                isPersonal: true,
                ownerUserId: "u-sam",
                projects: [{ id: "p-sam", name: "Personal Workspace" }],
              },
            ],
          },
        ],
        organizationId: "org-1",
        viewerUserId: "u-alex",
      });

      expect(scopes?.projects.map((project) => project.hint)).toEqual([
        "Alex Rivera (you)",
        "Sam Lee",
      ]);
    });
  });
});
