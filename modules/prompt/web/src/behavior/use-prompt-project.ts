/**
 * The project this screen is about, read from the host. `platform/app`'s prompt surfaces used
 * `usePromptProject()`, an application hook reaching the session client and org graph — both
 * sealed off from a feature-web package by ADR-004. The host answers the same two facts, read
 * here once rather than at each of twenty-odd call sites. `project` is `undefined` until one
 * is in scope, same as before, and every caller already handles that.
 */

import { useMemo } from "react";
import { usePromptHost } from "../model/prompt-host.ts";

export function usePromptProject() {
  const host = usePromptHost();
  const scope = host.scope();

  return useMemo(
    () => ({
      project: scope.projectId
        ? {
            id: scope.projectId,
            slug: scope.projectSlug ?? "",
            apiKey: scope.projectApiKey ?? "",
          }
        : void 0,
      projectId: scope.projectId ?? "",
      organizationId: scope.organizationId,
      teamId: scope.teamId,
      hasPermission: (permission: string) => host.hasPermission(permission),
    }),
    [
      host,
      scope.projectId,
      scope.projectSlug,
      scope.projectApiKey,
      scope.organizationId,
      scope.teamId,
    ],
  );
}
