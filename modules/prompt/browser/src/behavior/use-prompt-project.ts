/**
 * The project this screen is about, read from the host - `platform/app`'s
 * session client and org graph are sealed off from a feature-web package
 * (ADR-004). `project` is `undefined` until one is in scope, as before.
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
