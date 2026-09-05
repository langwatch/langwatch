/**
 * The project family, as the browser application mounts it.
 *
 * ONE SCREEN, ONE ADDRESS: `/settings`, the general settings page.
 *
 * WHY THIS PACKAGE, AND WHY IT IS NEW. The credentials family's rule: a key
 * belongs to the family that owns its TRANSPORT. This page writes
 * `organization.update` and `project.update`, so by the letter of that rule it
 * is split between two features; it is here because the PROJECT half is the
 * only half with nowhere else to go — `packages/features/project` had a
 * contract and a server and no web package at all — and because the two forms
 * are one page a member scrolls, not two addresses. What that costs is written
 * into the procedure map's docblock: the `organization` segment is spelled
 * exactly as the organization family spells it, so the graph stays one cache
 * entry.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider this
 * package's hooks run on and the host port that answers for the organization,
 * the project, the grants, the flag, the project switcher, the overlay address
 * and the two notices.
 */

import type { ComponentType } from "react";

export type ProjectScreenLoader = () => Promise<{ default: ComponentType }>;

export const projectScreens = {
  projectSettings: () => import("./project-settings.screen"),
} as const satisfies Record<string, ProjectScreenLoader>;

export type ProjectScreenName = keyof typeof projectScreens;

export { PROJECT_SETTINGS_PAGE_PERMISSION } from "./project-settings.screen";
export { projectApi, type ProjectApiMap } from "../../behavior/project-api";
export {
  ProjectHostPort,
  ProjectHostProvider,
  type ProjectFailureNotice,
  type ProjectHostOrganization,
  type ProjectHostProject,
  type ProjectSuccessNotice,
} from "../../model/project-host";
