import { describe, expect, it } from "vitest";
import {
  filterProvidersByScope,
  type ScopeHierarchy,
} from "../filterProvidersByScope";

type FixtureProvider = {
  provider: string;
  scopes: Array<{ scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }>;
};

const orgOnly: FixtureProvider = {
  provider: "openai",
  scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
};

const teamOne: FixtureProvider = {
  provider: "anthropic",
  scopes: [{ scopeType: "TEAM", scopeId: "team-1" }],
};

const teamTwo: FixtureProvider = {
  provider: "gemini",
  scopes: [{ scopeType: "TEAM", scopeId: "team-2" }],
};

const projectOne: FixtureProvider = {
  provider: "azure",
  scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
};

const projectTwo: FixtureProvider = {
  provider: "cohere",
  scopes: [{ scopeType: "PROJECT", scopeId: "proj-2" }],
};

const projectThree: FixtureProvider = {
  provider: "groq",
  scopes: [{ scopeType: "PROJECT", scopeId: "proj-3" }],
};

const orgAndProject: FixtureProvider = {
  provider: "bedrock",
  scopes: [
    { scopeType: "ORGANIZATION", scopeId: "org-1" },
    { scopeType: "PROJECT", scopeId: "proj-1" },
  ],
};

// proj-1 + proj-2 live in team-1; proj-3 lives in team-2.
const hierarchy: ScopeHierarchy = {
  organization: { id: "org-1" },
  teams: [{ id: "team-1" }, { id: "team-2" }],
  projects: [
    { id: "proj-1", teamId: "team-1" },
    { id: "proj-2", teamId: "team-1" },
    { id: "proj-3", teamId: "team-2" },
  ],
};

const ctx = (
  overrides: Partial<{
    currentTeamId: string;
    currentProjectId: string;
  }> = {},
) => ({ hierarchy, ...overrides });

const ALL = [
  orgOnly,
  teamOne,
  teamTwo,
  projectOne,
  projectTwo,
  projectThree,
  orgAndProject,
];

describe("filterProvidersByScope()", () => {
  /** @scenario The default view shows every provider I have access to across scopes */
  it("returns every provider unchanged when filter is 'all'", () => {
    expect(filterProvidersByScope(ALL, { kind: "all" }, ctx())).toEqual(ALL);
  });

  /** @scenario Picking the organization keeps every row in that org's tree */
  it("keeps everything inside the picked organization (org row + every team + every project)", () => {
    const result = filterProvidersByScope(
      ALL,
      { kind: "specific", scopeType: "ORGANIZATION", scopeId: "org-1" },
      ctx(),
    );
    expect(result).toEqual(ALL);
  });

  /** @scenario Picking a team keeps org rows, the team itself, and its projects */
  it("keeps org/team/own-projects when picking a team; hides sibling teams and their projects", () => {
    const result = filterProvidersByScope(
      ALL,
      { kind: "specific", scopeType: "TEAM", scopeId: "team-1" },
      ctx(),
    );
    expect(result).toContain(orgOnly);
    expect(result).toContain(orgAndProject);
    expect(result).toContain(teamOne);
    expect(result).toContain(projectOne);
    expect(result).toContain(projectTwo);
    expect(result).not.toContain(teamTwo);
    expect(result).not.toContain(projectThree);
  });

  /** @scenario Picking a project keeps org rows, the project's parent team, and the project itself */
  it("keeps org/parent-team/this-project when picking a project; hides siblings", () => {
    const result = filterProvidersByScope(
      ALL,
      { kind: "specific", scopeType: "PROJECT", scopeId: "proj-1" },
      ctx(),
    );
    expect(result).toContain(orgOnly);
    expect(result).toContain(orgAndProject);
    expect(result).toContain(teamOne);
    expect(result).toContain(projectOne);
    expect(result).not.toContain(teamTwo);
    expect(result).not.toContain(projectTwo);
    expect(result).not.toContain(projectThree);
  });

  it("team-current resolves against the current team id", () => {
    const result = filterProvidersByScope(
      ALL,
      { kind: "team-current" },
      ctx({ currentTeamId: "team-2" }),
    );
    expect(result).toContain(orgOnly);
    expect(result).toContain(teamTwo);
    expect(result).toContain(projectThree);
    expect(result).not.toContain(teamOne);
    expect(result).not.toContain(projectOne);
  });

  it("project-current resolves against the current project id", () => {
    const result = filterProvidersByScope(
      ALL,
      { kind: "project-current" },
      ctx({ currentProjectId: "proj-3" }),
    );
    expect(result).toContain(orgOnly);
    expect(result).toContain(teamTwo);
    expect(result).toContain(projectThree);
    expect(result).not.toContain(teamOne);
    expect(result).not.toContain(projectOne);
  });

  it("treats providers with no scopes as scope-less (only visible under 'all')", () => {
    const noScopes = { provider: "openai", scopes: [] };
    expect(filterProvidersByScope([noScopes], { kind: "all" }, ctx())).toEqual([
      noScopes,
    ]);
    expect(
      filterProvidersByScope(
        [noScopes],
        { kind: "specific", scopeType: "ORGANIZATION", scopeId: "org-1" },
        ctx(),
      ),
    ).toEqual([]);
    expect(
      filterProvidersByScope(
        [noScopes],
        { kind: "specific", scopeType: "PROJECT", scopeId: "proj-1" },
        ctx(),
      ),
    ).toEqual([]);
  });
});
