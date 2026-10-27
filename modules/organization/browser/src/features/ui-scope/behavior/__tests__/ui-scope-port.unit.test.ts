/**
 * The scope port itself, over one render's worth of answers.
 */

import { describe, expect, it } from "vitest";

import { BrowserUiScope } from "../ui-scope-capability";

describe("given the scope port over a resolved scope", () => {
  describe("when a screen asks where it is standing", () => {
    it("answers with the organization and project it was built for", () => {
      const scope = BrowserUiScope.create({
        reading: {
          status: "ready",
          organization: { id: "org-acme" },
          team: void 0,
          project: { id: "proj-app", slug: "app", name: "App" },
        },
        scopeHost: void 0,
      });

      expect(scope.activeScope()).toEqual({ organizationId: "org-acme", projectId: "proj-app" });
    });
  });

  describe("when nothing has resolved yet", () => {
    it("answers nothing rather than inventing a scope", () => {
      const scope = BrowserUiScope.create({
        reading: { status: "loading", organization: void 0, team: void 0, project: void 0 },
        scopeHost: void 0,
      });

      expect(scope.activeScope()).toEqual({ organizationId: null, projectId: null });
    });
  });
});
