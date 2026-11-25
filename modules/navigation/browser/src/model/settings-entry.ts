/**
 * Where the Settings entries open. Spec: specs/navigation/settings-shell-v2.feature;
 * ADR-098, amendment of 2026-11-19.
 */

import type { NavigationProject } from "@langwatch/navigation-contract";
import { isAggregateProjectKind } from "@langwatch/project-contract";

export const ORGANIZATION_SETTINGS_HREF = "/settings";
export const PROJECT_SETTINGS_HREF = "/settings/project";

export interface SettingsEntryReading {
  /** The project the address names; undefined off a project page or on a reserved word. */
  projectSlugFromAddress: string | undefined;
  /** The project the shell resolved, which the project settings pages go on to act on. */
  project: Pick<NavigationProject, "slug" | "kind" | "isPersonal"> | undefined;
  /** The address resolved to the reader's own personal workspace. */
  isPersonalTeam: boolean;
  /** `project:update` on that project, which the project's General page asks. */
  canUpdateProject: boolean;
}

/**
 * The project's General page when the address names a shared project the reader may update,
 * else the organization's. A personal workspace or an aggregate is never remembered, so the
 * project settings pages would act on another project: those open the organization's too.
 */
export function settingsEntryHref({
  projectSlugFromAddress,
  project,
  isPersonalTeam,
  canUpdateProject,
}: SettingsEntryReading): string {
  const opensProject =
    projectSlugFromAddress !== void 0 &&
    project?.slug === projectSlugFromAddress &&
    !project.isPersonal &&
    !isPersonalTeam &&
    !isAggregateProjectKind(project.kind) &&
    canUpdateProject;
  return opensProject ? PROJECT_SETTINGS_HREF : ORGANIZATION_SETTINGS_HREF;
}
