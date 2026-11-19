import { describe, expect, it } from "vitest";

import {
  personalWorkspaceHint,
  projectSearchText,
  sameNameHints,
} from "../src/components/scope/scope-project-hint.ts";

const teams = [
  { id: "team_platform", name: "Platform" },
  { id: "team_research", name: "Research" },
];

describe("sameNameHints", () => {
  describe("when two projects in different teams share a name", () => {
    /** @scenario Same-name projects in different teams name their team in a badge */
    it("names each one's team", () => {
      const hints = sameNameHints({
        projects: [
          { id: "p1", name: "Eval Harness", teamId: "team_platform" },
          { id: "p2", name: "Eval Harness", teamId: "team_research" },
        ],
        teams,
      });

      expect(Object.fromEntries(hints)).toEqual({ p1: "Platform", p2: "Research" });
    });
  });

  describe("when a project's name is unique", () => {
    /** @scenario A project with a unique name shows no badge */
    it("gives it no hint, even when the caller passed one", () => {
      const hints = sameNameHints({
        projects: [
          { id: "p1", name: "Web App", teamId: "team_platform", hint: "Alex Rivera (you)" },
          { id: "p2", name: "Billing", teamId: "team_platform" },
        ],
        teams,
      });

      expect(hints.size).toBe(0);
    });
  });

  describe("when names differ only by case or surrounding spaces", () => {
    /** @scenario Names that differ only by case or spacing count as the same name */
    it("counts them as the same name", () => {
      const hints = sameNameHints({
        projects: [
          { id: "p1", name: "Eval Harness", teamId: "team_platform" },
          { id: "p2", name: "eval harness ", teamId: "team_research" },
        ],
        teams,
      });

      expect(hints.size).toBe(2);
    });
  });

  describe("when the caller gives a hint", () => {
    /** @scenario A personal workspace names its owner, and the reader's own says "(you)" */
    it("prefers the caller's hint to the team name", () => {
      const hints = sameNameHints({
        projects: [
          { id: "p1", name: "Personal Workspace", teamId: "t1", hint: "Alex Rivera (you)" },
          { id: "p2", name: "Personal Workspace", teamId: "t2", hint: "Sam Lee" },
        ],
        teams: [
          { id: "t1", name: "Alex Rivera's Workspace" },
          { id: "t2", name: "Sam Lee's Workspace" },
        ],
      });

      expect(Object.fromEntries(hints)).toEqual({ p1: "Alex Rivera (you)", p2: "Sam Lee" });
    });
  });

  describe("when a repeated name has neither a hint nor a listed team", () => {
    /** @scenario A repeated name with nothing to tell it apart shows no badge */
    it("gives no hint", () => {
      const hints = sameNameHints({
        projects: [
          { id: "p1", name: "Eval Harness", teamId: "team_unknown" },
          { id: "p2", name: "Eval Harness" },
        ],
        teams,
      });

      expect(hints.size).toBe(0);
    });
  });
});

describe("personalWorkspaceHint", () => {
  /** @scenario A personal workspace names its owner, and the reader's own says "(you)" */
  it("says (you) after the reader's own name, and the plain name for anyone else", () => {
    expect(personalWorkspaceHint({ ownerName: "Alex Rivera", isViewer: true })).toBe(
      "Alex Rivera (you)",
    );
    expect(personalWorkspaceHint({ ownerName: "Sam Lee", isViewer: false })).toBe("Sam Lee");
  });
});

describe("projectSearchText", () => {
  /** @scenario Searching finds a project by its team or owner name */
  it("holds the project's name, its hint and its team's name", () => {
    const text = projectSearchText({
      project: { id: "p1", name: "Personal Workspace", teamId: "t1", hint: "Sam Lee" },
      teams: [{ id: "t1", name: "Sam Lee's Workspace" }],
    });

    expect(text).toContain("personal workspace");
    expect(text).toContain("sam lee");
    expect(text).toContain("sam lee's workspace");
  });
});
