/**
 * The project home, as the browser application mounts it.
 *
 * ONE SCREEN, ONE ADDRESS: `/[project]`, the page a reader lands on. Three
 * compositions resolve behind that one address — the briefing sheet, the lit
 * block with a composer in it, and the classic lobby — and which one renders is
 * a rollout decision the page makes for itself.
 *
 * WHY IT IS IN THE PROJECT PACKAGE. It is the PROJECT's home: everything on it
 * is a reading of one project — what arrived, what is failing, what the reader
 * touched, how far through setup they are. It shares this package with the
 * project's settings for the same reason the settings page is here: the project
 * is the subject, and `packages/features/project` is where the project's
 * contract and server already live.
 *
 * THE PAGE IS A COMPOSITION, and it is honest about that. It draws three other
 * families' published surfaces — the search palette and the feature icons from
 * `@langwatch/navigation-web/command-bar`, the assistant from
 * `@langwatch/langy-web`, the traces chart and the period selector from
 * `@langwatch/analytics-web` — because the home IS the page where those three
 * meet, and turning each into a host answer would be a redesign of the page
 * rather than a move of it. What DOES go through `ProjectHomeHostPort` is
 * everything that was `platform/app`'s and is nobody's feature: the reader, the
 * project and organization in scope, the grants, the rollouts, the deployment,
 * the motion preference and the one navigation.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider these
 * hooks run on and that host port. The shell around the page is NOT this
 * page's: the chrome layout route draws it, which is why the screen no longer
 * opens with a `DashboardLayout` of its own.
 */

import type { ComponentType } from "react";

export type ProjectHomeScreenLoader = () => Promise<{ default: ComponentType }>;

export const projectHomeScreens = {
  home: () => import("./home.screen"),
} as const satisfies Record<string, ProjectHomeScreenLoader>;

export type ProjectHomeScreenName = keyof typeof projectHomeScreens;

export { homeApi, type HomeApiMap, type RecentItem, type RecentItemType } from "../../behavior/home-api";
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
