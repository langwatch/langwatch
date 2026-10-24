/** Project UI lent by token: the hero's inline ask field and main's project switcher. */

import { lentComponent } from "@langwatch/browser-host/lent";
import { uiTokens } from "@langwatch/module";
import type { HeroAskFieldProps, ProjectSwitcherProps } from "@langwatch/project-contract";

const project = uiTokens("project");

export const HeroAskFieldToken = project.component<HeroAskFieldProps>("heroAskField");
export const ProjectSwitcherToken = project.component<ProjectSwitcherProps>("projectSwitcher");

/** The tokens above as ready components: a borrower imports these and writes no wrapper (§10.1). */
export const HeroAskField = lentComponent(HeroAskFieldToken);
