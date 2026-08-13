/**
 * The guard the whole governed analytics SQL family runs on every request.
 *
 * One claim, and it is the reason the function returns a project at all rather
 * than returning void: what comes back is the *credential's* project, never the
 * one the URL named. A handler that read the path id would widen scope with no
 * refusal anywhere to notice.
 *
 * The flag half is not unit-tested here on purpose — it reaches the real flag
 * store, and the REST suites drive it end to end through both env and an
 * organization-scoped rule, which is the whole chain a stub could only agree
 * with.
 *
 * @see specs/analytics/governed-sql-saved-charts.feature
 */

import { describe, expect, it } from "vitest";
import type { Project } from "~/generated/prisma/client";

import { callerProject } from "../[[...route]]/routeGuards";

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
      let returned: Project | undefined;
      try {
        returned = callerProject({
          project: projectOf("project-a"),
          requestedProjectId: "project-b",
        });
      } catch (error) {
        expect((error as { code?: string }).code).toBe("project_not_found");
      }

      expect(
        returned,
        "the guard returned a project for a foreign path id",
      ).toBeUndefined();
    });
  });

  describe("when the path carries no project id at all", () => {
    it("refuses, rather than treating the absence as agreement", () => {
      expect(() =>
        callerProject({
          project: projectOf("project-a"),
          requestedProjectId: undefined,
        }),
      ).toThrow();
    });
  });
});
