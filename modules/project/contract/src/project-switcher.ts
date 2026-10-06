/** Main's project selector, lent by project to pages outside the navigation shell (§10, §10.1). */

import { uiTokens } from "@langwatch/module";

/** The switcher needs nothing handed in: it reads the scope and the graph itself. */
export type ProjectSwitcherProps = Record<string, never>;

export const ProjectSwitcherToken =
  uiTokens("project").component<ProjectSwitcherProps>("projectSwitcher");
