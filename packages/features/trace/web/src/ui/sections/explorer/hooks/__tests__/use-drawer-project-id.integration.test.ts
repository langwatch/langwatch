// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDrawerStore } from "../../../../../index";
import { useDrawerProjectId } from "../use-drawer-project-id";

vi.mock("../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "ambient-project" } }),
}));

describe("useDrawerProjectId", () => {
  beforeEach(() => {
    useDrawerStore.getState().closeDrawer();
  });

  describe("given a drawer sitting in the project the chrome is on", () => {
    describe("when a trace opens without naming a project", () => {
      it("reads from the project the chrome is sitting in", () => {
        useDrawerStore.getState().openTrace("trace-1", 1_700_000_000_000);

        const { result } = renderHook(() => useDrawerProjectId());

        expect(result.current).toBe("ambient-project");
      });
    });
  });

  describe("given a trace whose project is not the one the chrome is on", () => {
    describe("when it opens naming that project", () => {
      /** @scenario "The replay reads the session's own workspace, not the last project visited" */
      it("reads from the named project rather than the chrome's", () => {
        useDrawerStore.getState().openTrace("trace-1", 1_700_000_000_000, {
          projectId: "personal-project",
        });

        const { result } = renderHook(() => useDrawerProjectId());

        expect(result.current).toBe("personal-project");
      });
    });

    describe("when a later turn opens without naming a project", () => {
      /** @scenario "Moving between turns stays in the session's workspace" */
      it("stays in the project the first turn named", () => {
        useDrawerStore.getState().openTrace("trace-1", 1_700_000_000_000, {
          projectId: "personal-project",
        });
        useDrawerStore.getState().openTrace("trace-2", 1_700_000_001_000);

        const { result } = renderHook(() => useDrawerProjectId());

        expect(result.current).toBe("personal-project");
      });
    });

    describe("when the drawer closes before the next trace opens", () => {
      /** @scenario "A replay opened fresh after closing reads the ambient project again" */
      it("forgets it, so the next trace is ambient again", () => {
        useDrawerStore.getState().openTrace("trace-1", 1_700_000_000_000, {
          projectId: "personal-project",
        });
        useDrawerStore.getState().closeDrawer();
        useDrawerStore.getState().openTrace("trace-2", 1_700_000_001_000);

        const { result } = renderHook(() => useDrawerProjectId());

        expect(result.current).toBe("ambient-project");
      });
    });
  });
});
