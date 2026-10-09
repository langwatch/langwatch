import { describe, expect, it } from "vitest";

import { currentScopeTarget } from "../ui-flags-source.ts";

describe("currentScopeTarget", () => {
  describe("when the scope names a project in an organization", () => {
    it("targets the project", () => {
      expect(currentScopeTarget({ organizationId: "org_1", projectId: "proj_1" })).toEqual({
        kind: "project",
        projectId: "proj_1",
        organizationId: "org_1",
      });
    });
  });

  describe("when the scope names only an organization", () => {
    it("targets the organization", () => {
      expect(currentScopeTarget({ organizationId: "org_1", projectId: null })).toEqual({
        kind: "organization",
        organizationId: "org_1",
      });
    });
  });

  describe("when the scope names nothing", () => {
    it("targets the signed-in user", () => {
      expect(currentScopeTarget({ organizationId: null, projectId: null })).toEqual({
        kind: "user",
      });
    });
  });
});
