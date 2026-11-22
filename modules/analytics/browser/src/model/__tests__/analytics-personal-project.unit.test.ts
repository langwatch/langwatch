/**
 * Whether the project on screen is a person's own.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import { isPersonalProject, type AnalyticsScopeGraph } from "../analytics-personal-project.ts";

const GRAPH: AnalyticsScopeGraph = [
  {
    teams: [
      { isPersonal: true, projects: [{ id: "project-mine" }] },
      { isPersonal: false, projects: [{ id: "project-team" }] },
    ],
  },
];

describe("isPersonalProject", () => {
  /** @scenario "A personal project's Analytics reads keep Langy's turns" */
  it("is true for the project of a personal workspace", () => {
    expect(isPersonalProject({ graph: GRAPH, projectId: "project-mine" })).toBe(true);
  });

  /** @scenario "A personal project's Analytics reads keep Langy's turns" */
  it.each([
    { given: "a team's project", graph: GRAPH, projectId: "project-team" },
    { given: "a project the graph does not name", graph: GRAPH, projectId: "project-other" },
    { given: "a graph that has not arrived", graph: [], projectId: "project-mine" },
    { given: "no project in scope", graph: GRAPH, projectId: undefined },
  ])("is false for $given", ({ graph, projectId }) => {
    expect(isPersonalProject({ graph, projectId })).toBe(false);
  });
});
