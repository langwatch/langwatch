/** The filter sidebar analytics lends the screens that filter traces (§10, §10.1). */

import { uiTokens } from "@langwatch/module";

/** What a screen hands analytics' filter sidebar; it reads the filters from the URL itself. */
export type FilterSidebarProps = { defaultShowFilters?: boolean; hideTopics?: boolean };

export const FilterSidebarToken =
  uiTokens("analytics").component<FilterSidebarProps>("filterSidebar");
