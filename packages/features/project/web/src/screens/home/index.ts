/**
 * The project home, at `/[project]`. One of three compositions renders behind that one address; which one is a rollout decision the page makes itself. Reads reader/scope/grants/rollouts through `ProjectHomeHostPort`.
 */

import type { ComponentType } from "react";

export type ProjectHomeScreenLoader = () => Promise<{ default: ComponentType }>;

export const projectHomeScreens = {
  home: () => import("./home.screen"),
} as const satisfies Record<string, ProjectHomeScreenLoader>;

export type ProjectHomeScreenName = keyof typeof projectHomeScreens;

export {
  homeApi,
  type HomeApiMap,
  type RecentItem,
  type RecentItemType,
} from "../../behavior/home-api";
export {
  ProjectHomeHostPort,
  ProjectHomeHostProvider,
  useProjectHomeHost,
  type ProjectHomeDeployment,
  type ProjectHomeFlagReading,
  type ProjectHomeLangyVisibility,
  type ProjectHomeOrganization,
  type ProjectHomeProject,
  type ProjectHomeUser,
} from "../../model/project-home-host";
export { SIGNAL_FOCUSED_HOME_FLAG } from "./components/use-show-signal-focused-home";
