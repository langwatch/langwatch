import { describe, expect, it } from "vitest";
import { filterProvidersByScope } from "../filterProvidersByScope";

type FixtureProvider = {
  provider: string;
  scopes: Array<{ scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }>;
};

const orgOnly: FixtureProvider = {
  provider: "openai",
  scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
};

const teamOnly: FixtureProvider = {
  provider: "anthropic",
  scopes: [{ scopeType: "TEAM", scopeId: "team-1" }],
};

const projectOnly: FixtureProvider = {
  provider: "azure",
  scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
};

const projectTwo: FixtureProvider = {
  provider: "openai",
  scopes: [{ scopeType: "PROJECT", scopeId: "proj-2" }],
};

const orgAndProject: FixtureProvider = {
  provider: "bedrock",
  scopes: [
    { scopeType: "ORGANIZATION", scopeId: "org-1" },
    { scopeType: "PROJECT", scopeId: "proj-1" },
  ],
};

describe("filterProvidersByScope()", () => {
  /** @scenario The default view shows every provider I have access to across scopes */
  it("returns every provider unchanged when filter is 'all'", () => {
    const all = [orgOnly, teamOnly, projectOnly, projectTwo, orgAndProject];
    expect(filterProvidersByScope(all, "all", "proj-1")).toEqual(all);
  });

  /** @scenario Filtering by "Organization" hides team- and project-only rows */
  it("keeps only providers attached at the organization scope", () => {
    const all = [orgOnly, teamOnly, projectOnly, projectTwo, orgAndProject];
    const result = filterProvidersByScope(all, "organization", "proj-1");
    expect(result).toContain(orgOnly);
    expect(result).toContain(orgAndProject);
    expect(result).not.toContain(teamOnly);
    expect(result).not.toContain(projectOnly);
    expect(result).not.toContain(projectTwo);
  });

  /** @scenario Filtering by "This project" hides everything not attached to the current project */
  it("keeps only providers attached to the current project (org/team rows are hidden)", () => {
    const all = [orgOnly, teamOnly, projectOnly, projectTwo, orgAndProject];
    const result = filterProvidersByScope(all, "project", "proj-1");
    expect(result).toContain(projectOnly);
    expect(result).toContain(orgAndProject); // also attached to proj-1
    expect(result).not.toContain(orgOnly);
    expect(result).not.toContain(teamOnly);
    expect(result).not.toContain(projectTwo);
  });

  it("project filter with no projectId returns nothing", () => {
    const all = [orgOnly, projectOnly];
    expect(filterProvidersByScope(all, "project", undefined)).toEqual([]);
  });

  it("treats providers with no scopes as scope-less (only visible under 'all')", () => {
    const noScopes = { provider: "openai", scopes: [] };
    const all = [noScopes];
    expect(filterProvidersByScope(all, "all", "proj-1")).toEqual(all);
    expect(filterProvidersByScope(all, "organization", "proj-1")).toEqual([]);
    expect(filterProvidersByScope(all, "project", "proj-1")).toEqual([]);
  });
});
