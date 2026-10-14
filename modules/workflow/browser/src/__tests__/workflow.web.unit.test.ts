import { describe, expect, it } from "vitest";

import { workflowWeb } from "../workflow.web.ts";

describe("given a browser that installs workflow", () => {
  describe("when the router opens the workflows list", () => {
    /** @scenario "The workflows list is guarded by workflows:view" */
    it("requires workflows:view, as main's page guard did", () => {
      expect(workflowWeb.installation.screens["pages/[project]/workflows"]?.requires).toBe(
        "workflows:view",
      );
    });
  });

  describe("when the router opens the Studio or the workflow chat", () => {
    it("requires no grant of its own, as on main", () => {
      const { screens } = workflowWeb.installation;

      expect(screens["pages/[project]/studio/[workflow]"]).not.toHaveProperty("requires");
      expect(screens["pages/[project]/chat/[workflow]"]).not.toHaveProperty("requires");
    });
  });
});
