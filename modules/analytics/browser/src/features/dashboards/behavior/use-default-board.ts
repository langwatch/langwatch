/**
 * The board the member lands on in each project, chosen with "Set as default". A preference,
 * so it lives in analytics' persisted slice of the global UI store (ARCHITECTURE §10.2): kept
 * per signed-in reader, forgotten at sign-out, never sent to the server.
 */

import { defineSlice } from "@langwatch/browser-host/global-store";

import { useAnalyticsHost } from "../../../model/analytics-host.ts";

type DefaultBoardsState = {
  /** The chosen board id, by project id. */
  byProject: Readonly<Record<string, string>>;
  setDefault: (choice: { projectId: string; dashboardId: string }) => void;
};

const useDefaultBoardsStore = defineSlice<DefaultBoardsState>({
  name: "analytics:default-boards",
  create: (set) => ({
    byProject: {},
    setDefault: ({ projectId, dashboardId }) =>
      set((state) => ({ byProject: { ...state.byProject, [projectId]: dashboardId } })),
  }),
  persist: {
    key: "langwatch.dashboard.defaultBoards",
    partialize: ({ byProject }) => ({ byProject }),
  },
});

/** The member's default board in the project in scope, if any, and the write that sets it. */
export function useDefaultBoard() {
  const projectId = useAnalyticsHost().project()?.id ?? "";
  const defaultBoardId = useDefaultBoardsStore((state) => state.byProject[projectId]);
  const setDefault = useDefaultBoardsStore((state) => state.setDefault);
  return {
    defaultBoardId,
    setDefaultBoard: (dashboardId: string) => setDefault({ projectId, dashboardId }),
  };
}
