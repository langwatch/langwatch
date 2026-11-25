/** Project UI lent by token: the hero's inline ask field and main's project switcher. */

import { uiTokens } from "@langwatch/module";
import type { HeroAskFieldProps, ProjectSwitcherProps } from "@langwatch/project-contract";

const project = uiTokens("project");

export const HeroAskFieldToken = project.component<HeroAskFieldProps>("heroAskField");
export const ProjectSwitcherToken = project.component<ProjectSwitcherProps>("projectSwitcher");
