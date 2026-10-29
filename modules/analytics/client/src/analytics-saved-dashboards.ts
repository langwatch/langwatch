/**
 * The saved-dashboards list analytics lends navigation's sidebar on dashboards pages, and the
 * member's starred dashboards it lends the other products' sidebars (§10.1).
 */

import { uiTokens } from "@langwatch/module";

/**
 * What navigation hands the list: the address under `/dashboards/` the reader has open
 * (a board id, `curated/<template>`, `templates`), empty at the area itself, analytics reads it.
 */
export type SavedDashboardsProps = { openPath: string | undefined };

export const SavedDashboardsToken =
  uiTokens("analytics").component<SavedDashboardsProps>("savedDashboards");

/** The Dashboards section takes nothing: analytics reads the member's stars itself. */
export type StarredDashboardsProps = Record<string, never>;

/**
 * The LLM Ops sidebar's Dashboards section: the member's stars in the project in scope as
 * pinned dashboards, and a "+" for a member who may create one.
 */
export const StarredDashboardsToken =
  uiTokens("analytics").component<StarredDashboardsProps>("starredDashboards");
