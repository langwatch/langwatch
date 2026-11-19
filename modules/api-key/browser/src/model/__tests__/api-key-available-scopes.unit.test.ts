import { describe, expect, it } from "vitest";

import { availableScopesOf, withOwnerHints } from "../api-key-available-scopes.ts";

const organization = {
  id: "org_1",
  name: "ACME",
  teams: [
    {
      id: "team_platform",
      name: "Platform",
      projects: [{ id: "p_eval_platform", name: "Eval Harness" }],
    },
    {
      id: "team_alex",
      name: "Alex Rivera's Workspace",
      isPersonal: true,
      ownerUserId: "user_alex",
      projects: [{ id: "p_alex", name: "Personal Workspace" }],
    },
    {
      id: "team_sam",
      name: "Sam Lee's Workspace",
      isPersonal: true,
      ownerUserId: "user_sam",
      projects: [{ id: "p_sam", name: "Personal Workspace" }],
    },
  ],
};

describe("availableScopesOf", () => {
  describe("when an admin sees their own personal workspace and a teammate's", () => {
    /** @scenario A personal workspace names its owner, and the reader's own says "(you)" */
    it("hints each personal project with its owner, the reader's own with (you)", () => {
      const scopes = availableScopesOf({ organization, viewerUserId: "user_alex" });

      expect(scopes.projects).toEqual([
        { id: "p_eval_platform", name: "Eval Harness", teamId: "team_platform" },
        {
          id: "p_alex",
          name: "Personal Workspace",
          teamId: "team_alex",
          hint: "Alex Rivera (you)",
        },
        { id: "p_sam", name: "Personal Workspace", teamId: "team_sam", hint: "Sam Lee" },
      ]);
      expect(scopes.teams.map((team) => team.name)).toContain("Sam Lee's Workspace");
    });
  });

  describe("when a non-admin sees only their own personal workspace", () => {
    /** @scenario A reader who sees only their own personal workspace sees no owner badge */
    it("carries no other person's name", () => {
      const scopes = availableScopesOf({
        organization: { ...organization, teams: organization.teams.slice(0, 2) },
        viewerUserId: "user_alex",
      });

      expect(JSON.stringify(scopes)).not.toContain("Sam Lee");
      expect(scopes.projects.find((project) => project.id === "p_alex")?.hint).toBe(
        "Alex Rivera (you)",
      );
    });
  });

  describe("when a personal team's name no longer carries its owner", () => {
    /** @scenario A personal team that no longer carries its owner in its name shows the whole team name */
    it("hints with the whole team name", () => {
      const scopes = availableScopesOf({
        organization: {
          ...organization,
          teams: [{ ...organization.teams[2]!, name: "Lab bench" }],
        },
        viewerUserId: "user_alex",
      });

      expect(scopes.projects[0]?.hint).toBe("Lab bench");
    });
  });

  describe("when the organization has not loaded", () => {
    it("offers no scopes", () => {
      expect(availableScopesOf({ organization: undefined, viewerUserId: "user_alex" })).toEqual({
        organization: null,
        teams: [],
        projects: [],
      });
    });
  });
});

describe("withOwnerHints", () => {
  describe("when the key drawers list the organization's projects", () => {
    /** @scenario A personal workspace names its owner, and the reader's own says "(you)" */
    it("carries the owner hints of the scopes the reader can see onto them", () => {
      const scopes = availableScopesOf({ organization, viewerUserId: "user_alex" });

      expect(
        withOwnerHints({
          projects: [
            { id: "p_alex", name: "Personal Workspace", teamId: "team_alex" },
            { id: "p_other", name: "Web App", teamId: "team_platform" },
          ],
          scopes,
        }),
      ).toEqual([
        {
          id: "p_alex",
          name: "Personal Workspace",
          teamId: "team_alex",
          hint: "Alex Rivera (you)",
        },
        { id: "p_other", name: "Web App", teamId: "team_platform" },
      ]);
    });
  });
});
