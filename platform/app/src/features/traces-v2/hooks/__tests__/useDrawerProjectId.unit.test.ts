// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDrawerStore } from "../../stores/drawerStore";
import { useDrawerProjectId } from "../useDrawerProjectId";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "ambient-project" } }),
}));

describe("useDrawerProjectId", () => {
  beforeEach(() => {
    useDrawerStore.getState().closeDrawer();
  });

  describe("given the opener named no project", () => {
    it("reads from the project the chrome is sitting in", () => {
      useDrawerStore.getState().openTrace("trace-1", 1_700_000_000_000);

      const { result } = renderHook(() => useDrawerProjectId());

      expect(result.current).toBe("ambient-project");
    });
  });

  describe("given the opener named the trace's own project", () => {
    /** @scenario "The replay reads the session's own workspace, not the last project visited" */
    it("reads from the named project rather than the chrome's", () => {
      useDrawerStore.getState().openTrace("trace-1", 1_700_000_000_000, {
        projectId: "personal-project",
      });

      const { result } = renderHook(() => useDrawerProjectId());

      expect(result.current).toBe("personal-project");
    });

    /** @scenario "Moving between turns stays in the session's workspace" */
    it("keeps it when a later turn opens without naming a project", () => {
      useDrawerStore.getState().openTrace("trace-1", 1_700_000_000_000, {
        projectId: "personal-project",
      });
      useDrawerStore.getState().openTrace("trace-2", 1_700_000_001_000);

      const { result } = renderHook(() => useDrawerProjectId());

      expect(result.current).toBe("personal-project");
    });

    /** @scenario "A replay opened fresh after closing reads the ambient project again" */
    it("forgets it once the drawer closes, so the next trace is ambient again", () => {
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
