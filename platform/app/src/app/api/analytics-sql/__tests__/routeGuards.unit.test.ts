/**
 * The guard the whole LangWatchQL analytics SQL family runs on every request.
 *
 * One claim, and it is the reason the function returns a project at all rather
 * than returning void: what comes back is the *credential's* project, never the
 * one the URL named. A handler that read the path id would widen scope with no
 * refusal anywhere to notice.
 *
 * The flag half is not unit-tested here on purpose — it reaches the real flag
 * store, and the REST suites drive it end to end through both env and an
 * organization-scoped rule, which is the whole chain a stub could only agree
 * with. What the pair below can hold without one is its *ordering*.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { describe, expect, it } from "vitest";
import type { Project } from "~/generated/prisma/client";

import { callerProject, lwqlProject } from "../[[...route]]/routeGuards";

const projectOf = (id: string): Project =>
  ({ id, teamId: `team-${id}`, slug: id }) as Project;

describe("given a request whose URL carries a project id", () => {
  describe("when the path names the credential's own project", () => {
    it("answers with the credential's project", () => {
      const project = projectOf("project-a");

      expect(
        callerProject({ project, requestedProjectId: "project-a" }),
      ).toStrictEqual(project);
    });
  });

  describe("when the path names another project", () => {
    it("refuses as not found rather than returning the project the path named", () => {
      expect(() =>
        callerProject({
          project: projectOf("project-a"),
          requestedProjectId: "project-b",
        }),
      ).toThrow(expect.objectContaining({ code: "project_not_found" }));
    });
  });

  describe("when the path carries no project id at all", () => {
    it("refuses, rather than treating the absence as agreement", () => {
      expect(() =>
        callerProject({
          project: projectOf("project-a"),
          requestedProjectId: undefined,
        }),
      ).toThrow(expect.objectContaining({ code: "project_not_found" }));
    });
  });
});

describe("given the ordered pair every route in the family calls", () => {
  describe("when the path names another project", () => {
    /**
     * The ordering claim, and the only half of the pair a unit can hold: the
     * refusal is the path's, reached without the flag store — which this test
     * would not be able to reach at all.
     */
    it("refuses on the path before the feature switch is ever consulted", async () => {
      await expect(
        lwqlProject({
          project: projectOf("project-a"),
          requestedProjectId: "project-b",
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "project_not_found" }));
    });
  });
});
