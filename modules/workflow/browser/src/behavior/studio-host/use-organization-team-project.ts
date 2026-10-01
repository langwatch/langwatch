/**
 * The scope reading the moved studio modules already do.
 */

import { Temporal } from "@langwatch/time";
import { useWorkflowHost } from "@langwatch/workflow-browser-kit";
import type { Project } from "@langwatch/workflow-contract";
import { useMemo } from "react";

/**
 * The project row, as the studio's closure reads it. The API key is not part of it:
 * only the publish screen's API modal fetches it.
 */
export type StudioProject = Omit<Project, "apiKey">;

export type StudioOrganization = { id: string };
export type StudioTeam = { id: string };

export type StudioScopeReading = {
  project: StudioProject | undefined;
  organization: StudioOrganization | undefined;
  team: StudioTeam | undefined;
  projectId: string | undefined;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  /** False while the composing application is still resolving the scope. */
  isResolved: boolean;
  isLoading: boolean;
};

export function useOrganizationTeamProject(
  /**
   * Accepted and ignored, all of it.
   */
  _options: {
    redirectToOnboarding?: boolean;
    redirectToProjectOnboarding?: boolean;
    keepFetching?: boolean;
  } = {},
): StudioScopeReading {
  const host = useWorkflowHost();
  const scope = host.scope();

  return useMemo(() => {
    const project: StudioProject | undefined = scope.projectId
      ? {
          id: scope.projectId,
          slug: scope.projectSlug ?? "",
          name: scope.projectName ?? scope.projectSlug ?? "",
          teamId: scope.teamId ?? "",
          language: "",
          framework: "",
          firstMessage: false,
          integrated: false,
          createdAt: Temporal.Instant.fromEpochMilliseconds(0),
          updatedAt: Temporal.Instant.fromEpochMilliseconds(0),
        }
      : void 0;

    return {
      project,
      organization: scope.organizationId ? { id: scope.organizationId } : void 0,
      team: scope.teamId ? { id: scope.teamId } : void 0,
      projectId: scope.projectId,
      hasPermission: (permission: string) => host.hasPermission(permission),
      hasAnyPermission: (permissions: string[]) =>
        permissions.some((permission) => host.hasPermission(permission)),
      isResolved: scope.isResolved ?? !!scope.projectId,
      isLoading: !(scope.isResolved ?? !!scope.projectId),
    };
  }, [host, scope]);
}
