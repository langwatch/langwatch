/** The saved-dashboards list analytics lends navigation's sidebar on dashboards pages (§10.1). */

import { uiTokens } from "@langwatch/module";

/** What navigation hands the list: the board open now, if any. */
export type SavedDashboardsProps = { activeDashboardId: string | undefined };

export const SavedDashboardsToken =
  uiTokens("analytics").component<SavedDashboardsProps>("savedDashboards");
