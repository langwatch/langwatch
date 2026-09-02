/**
 * The scope reading the moved studio modules already do.
 *
 * Fifty-six files in the studio's closure call
 * `useOrganizationTeamProject()`, and between all of them they read exactly
 * seven things: `project`, `organization`, `team`, `projectId`,
 * `hasPermission`, `hasAnyPermission` and `modelProviders`, plus the two
 * settling flags. The application's hook is 771 lines because it also resolves
 * the whole organization graph, the demo project, the external-member
 * permission table and the onboarding redirect; none of that is a screen's
 * business and none of it travelled.
 *
 * WHAT IT ANSWERS FROM: the family's `WorkflowHostPort` for the scope and the
 * grants — the composing application already resolved both — and one query for
 * the project's model providers, which is the single reading the port does not
 * carry. That query is shared with every other caller through the tRPC cache
 * key, so fifty-six components asking for it is one request.
 *
 * `redirectToOnboarding` IS ACCEPTED AND IGNORED, deliberately. Two call sites
 * pass it. Sending a reader to onboarding is the application's decision about
 * its own route table, and a screen that navigates on the strength of a scope
 * it could not resolve is how a studio ends up bouncing a signed-in user out of
 * the page they asked for. The address stays where the reader put it.
 */

import { useMemo } from "react";

import { useWorkflowHost, type WorkflowCopyTarget } from "../model/workflow-host";
import type { Project } from "../model/prisma-types";
import { api } from "./api";

/**
 * The project row, as the studio's closure reads it.
 *
 * It is the whole `Project` shape rather than the three fields the port
 * carries, because a dozen surfaces pass `project` straight into a component
 * typed by the Prisma row. The fields the port cannot answer are filled with
 * the row's own empty values; `apiKey` is the one that is actually READ — the
 * API-snippet dialogs print it — so it is fetched.
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
   *
   * `platform/app` derived this inside each replicate dialog, by walking the
   * organization graph and asking `~/server/api/rbac` about the reader's team
   * membership — a server module imported into a browser component. The
   * composing application answers it now, from `@langwatch/authz-contract`, and
   * the dialogs read the answer.
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
   * Accepted and ignored, all of it. Both bouncers — "no organization" and "no
   * project" — are the application's decision about its own route table, and a
   * screen that navigates on a scope it could not resolve is how a page bounces
   * a signed-in reader out of the address they asked for.
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
   * ONE EXTRA READ THE APPLICATION DID NOT MAKE, and it is worth naming.
   * `platform/app` had `apiKey` on the project row the shell already held; the
   * host port carries an identity and a slug, not a credential. The snippet
   * dialogs print the key, so it is asked for here — once per document, since
   * every caller shares the cache entry.
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
