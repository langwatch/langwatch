/**
 * The board the address opens, asked of `boards.resolve` while the organization's library is on.
 * The shell reads it for the chrome and hands it to the top bar's project pick through context.
 */

import { createContext, useContext } from "react";

import { useNavigationHost } from "../model/navigation-host.ts";
import { isOrganizationCuratedPath, type OpenBoard, openBoardIdAt } from "../model/open-board.ts";
import { navigationApi } from "./navigation-api.ts";
import { useFollowBoardProject } from "./use-follow-board-project.ts";

/** Every From LangWatch board is homed in LLM Ops and read for the project in view (D5). */
const CURATED_BOARD: OpenBoard = { homeProduct: "llm-ops", isProjectShared: false };

export function useOpenBoard({ enabled }: { enabled: boolean }): {
  openBoard: OpenBoard | null;
  /** True while the board's home is still being asked; a failed read is no board. */
  isLoading: boolean;
} {
  const host = useNavigationHost();
  const pathname = host.pathname();
  const organizationId = host.organization()?.id ?? "";
  const dashboardId = openBoardIdAt(pathname) ?? "";
  const asks = enabled && organizationId !== "" && dashboardId !== "";
  const resolved = navigationApi.boards.resolve.useQuery(
    { organizationId, dashboardId },
    { enabled: asks },
  );
  useFollowBoardProject({ board: asks ? resolved.data : void 0 });
  if (enabled && isOrganizationCuratedPath(pathname)) {
    return { openBoard: CURATED_BOARD, isLoading: false };
  }
  if (!asks) return { openBoard: null, isLoading: false };
  if (resolved.data) {
    const { homeProduct, scope } = resolved.data;
    return { openBoard: { homeProduct, isProjectShared: scope === "PROJECT" }, isLoading: false };
  }
  return { openBoard: null, isLoading: !resolved.isError };
}

/** The open board the shell resolved; null outside a shell or with no board open. */
export const OpenBoardContext = createContext<OpenBoard | null>(null);

export function useOpenBoardInShell(): OpenBoard | null {
  return useContext(OpenBoardContext);
}
