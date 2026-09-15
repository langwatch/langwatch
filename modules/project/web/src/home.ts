/**
 * Project home compositions at `/[project]`: rollout decides which one; reads
 * reader/scope/grants/rollouts through ProjectHomeHost.
 */

import type { ComponentType } from "react";

export type ProjectHomeScreenLoader = () => Promise<{ default: ComponentType }>;

export const projectHomeScreens = {
  home: () => import("./ui/sections/home/home-screen.tsx"),
} as const satisfies Record<string, ProjectHomeScreenLoader>;

export type ProjectHomeScreenName = keyof typeof projectHomeScreens;

export {
  homeApi,
  type HomeApiMap,
  type RecentItem,
  type RecentItemType,
} from "./behavior/home-api.ts";
export {
  ProjectHomeHost,
  ProjectHomeHostProvider,
  useProjectHomeHost,
  type ProjectHomeDeployment,
  type ProjectHomeFlagReading,
  type ProjectHomeLangyVisibility,
  type ProjectHomeOrganization,
  type ProjectHomeProject,
  type ProjectHomeUser,
} from "./model/project-home-host.ts";
export { SIGNAL_FOCUSED_HOME_FLAG } from "./ui/sections/home/components/use-show-signal-focused-home.ts";
