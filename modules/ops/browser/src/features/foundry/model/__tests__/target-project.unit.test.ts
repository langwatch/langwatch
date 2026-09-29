import { describe, expect, it } from "vitest";

import { pickTargetProject } from "../target-project.ts";

const projects = [
  { id: "p1", apiKey: "k1" },
  { id: "p2", apiKey: "k2" },
];

describe("given the Foundry's project list", () => {
  describe("when the page has no project and none was picked", () => {
    it("targets the first listed project, the one the selector shows", () => {
      expect(
        pickTargetProject({ selectedProjectId: null, currentProjectId: undefined, projects }),
      ).toBe(projects[0]);
    });
  });

  describe("when a project was picked", () => {
    it("targets the picked project over the page's", () => {
      expect(pickTargetProject({ selectedProjectId: "p2", currentProjectId: "p1", projects })).toBe(
        projects[1],
      );
    });
  });

  describe("when the page has a project and none was picked", () => {
    it("targets the page's project", () => {
      expect(pickTargetProject({ selectedProjectId: null, currentProjectId: "p2", projects })).toBe(
        projects[1],
      );
    });
  });

  describe("when no projects are listed", () => {
    it("targets nothing", () => {
      expect(
        pickTargetProject({ selectedProjectId: null, currentProjectId: "p1", projects: [] }),
      ).toBeUndefined();
    });
  });
});
