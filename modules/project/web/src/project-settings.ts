/**
 * The project settings page (`/settings`); mounts tRPC Provider and host port
 * that serves organization, project, and related dependencies.
 */

import type { ComponentType } from "react";

export type ProjectScreenLoader = () => Promise<{ default: ComponentType }>;

export const projectScreens = {
  projectSettings: () => import("./ui/sections/project-settings/project-settings-screen.tsx"),
} as const satisfies Record<string, ProjectScreenLoader>;

export type ProjectScreenName = keyof typeof projectScreens;

export { PROJECT_SETTINGS_PAGE_PERMISSION } from "./ui/sections/project-settings/project-settings-screen.tsx";
export { projectApi, type ProjectApiMap } from "./behavior/project-api.ts";
export {
  ProjectHostPort,
  ProjectHostProvider,
  type ProjectFailureNotice,
  type ProjectHostOrganization,
  type ProjectHostProject,
  type ProjectSuccessNotice,
} from "./model/project-host.ts";
