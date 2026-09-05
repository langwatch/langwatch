/**
 * The scope reading the moved studio modules already do.
 */

import { useMemo } from "react";

import { useWorkflowHost, type WorkflowCopyTarget } from "../../model/workflow-host";
import type { Project } from "@langwatch/workflow-contract";
import { api } from "./api";

/**
 * The project row, as the studio's closure reads it.
 */
export type StudioProject = Project;

export type StudioOrganization = { id: string };
export type StudioTeam = { id: string };

export type StudioScopeReading = {
  project: StudioProject | undefined;
  organization: StudioOrganization | undefined;
  team: StudioTeam | undefined;
  projectId: string | undefined;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  /**
   * Every project the reader may replicate into, already derived by the host.
   */
  copyTargets: readonly WorkflowCopyTarget[];
  // oxlint-disable-next-line no-explicit-any
  modelProviders: any;
  /** False while the composing application is still resolving the scope. */
  isResolved: boolean;
  isLoading: boolean;
  isRefetching: boolean;
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

  const modelProviders = api.modelProvider.getAllForProject.useQuery(
    { projectId: scope.projectId ?? "" },
    { enabled: !!scope.projectId },
  );

  /**
   * ONE EXTRA READ THE APPLICATION DID NOT MAKE, and it is worth naming. `platform/app` had
   * `apiKey` on the project row the shell already held; the host port carries an identity
   * and a slug, not a credential.
   */
  const projectApiKey = api.project.getProjectAPIKey.useQuery(
    { projectId: scope.projectId ?? "" },
    { enabled: !!scope.projectId },
  );

  return useMemo(() => {
    const project: StudioProject | undefined = scope.projectId
      ? {
          id: scope.projectId,
          slug: scope.projectSlug ?? "",
          name: scope.projectName ?? scope.projectSlug ?? "",
          apiKey: (projectApiKey.data as { apiKey?: string } | undefined)?.apiKey ?? "",
          teamId: scope.teamId ?? "",
          language: "",
          framework: "",
          firstMessage: false,
          integrated: false,
          createdAt: new Date(0),
          updatedAt: new Date(0),
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
      copyTargets: host.copyTargets(),
      // oxlint-disable-next-line no-explicit-any
      modelProviders: modelProviders.data as any,
      isResolved: scope.isResolved ?? !!scope.projectId,
      isLoading: !(scope.isResolved ?? !!scope.projectId),
      isRefetching: modelProviders.isRefetching,
    };
  }, [host, scope, modelProviders.data, modelProviders.isRefetching, projectApiKey.data]);
}
