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

/** A project the Dashboards section lists and creates in, named in its title. */
export type StarredDashboardsProject = { id: string; slug: string; name: string };

/**
 * What navigation hands the section: nothing on a project's own pages, where analytics reads
 * the project in scope; `project` on a page about none (Gateway, Coding agents).
 */
export type StarredDashboardsProps = { project?: StarredDashboardsProject };

/**
 * The sidebar's Dashboards section: the member's stars in the project as pinned dashboards,
 * and a "+" for a member who may create one.
 */
export const StarredDashboardsToken =
  uiTokens("analytics").component<StarredDashboardsProps>("starredDashboards");
