/** The saved-dashboards list analytics lends navigation's sidebar on dashboards pages (§10.1). */

import { uiTokens } from "@langwatch/module";

/**
 * What navigation hands the list: the address under `/dashboards/` the reader has open
 * (a board id, `curated/<template>`, `templates`), empty at the area itself, analytics reads it.
 */
export type SavedDashboardsProps = { openPath: string | undefined };

export const SavedDashboardsToken =
  uiTokens("analytics").component<SavedDashboardsProps>("savedDashboards");
