/**
 * The saved-dashboards list analytics lends navigation's sidebar on dashboards pages, and the
 * member's starred dashboards it lends the other products' sidebars (§10.1).
 */

import { lentComponent } from "@langwatch/browser-host/lent";
import { uiTokens } from "@langwatch/module";

/**
 * What navigation hands the list: the address under `/dashboards/` the reader has open
 * (a board id, `curated/<template>`, `templates`), empty at the area itself, analytics reads it.
 */
export type SavedDashboardsProps = { openPath: string | undefined };

export const SavedDashboardsToken =
  uiTokens("analytics").component<SavedDashboardsProps>("savedDashboards");

/** The starred group takes nothing: analytics reads the member's stars itself. */
export type StarredDashboardsProps = Record<string, never>;

/** Draws nothing unless the member has starred a dashboard in the project in scope. */
export const StarredDashboardsToken =
  uiTokens("analytics").component<StarredDashboardsProps>("starredDashboards");

/** The tokens above as ready components: a borrower imports these and writes no wrapper (§10.1). */
export const SavedDashboards = lentComponent(SavedDashboardsToken);
export const StarredDashboards = lentComponent(StarredDashboardsToken);
