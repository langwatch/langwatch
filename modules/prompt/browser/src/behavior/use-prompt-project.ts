/**
 * The project this screen is about, read from the host's session: a
 * browser module never reaches the shell's session client directly.
 * `project` is `undefined` until one is in scope.
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
          }
        : void 0,
      projectId: scope.projectId ?? "",
      organizationId: scope.organizationId,
      teamId: scope.teamId,
      hasPermission: (permission: string) => host.hasPermission(permission),
    }),
    [host, scope.projectId, scope.projectSlug, scope.organizationId, scope.teamId],
  );
}
