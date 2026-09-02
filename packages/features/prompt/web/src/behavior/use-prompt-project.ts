/**
 * The project this screen is about, read from the host.
 *
 * `platform/app`'s prompt surfaces asked `usePromptProject()` — an
 * application hook that reaches the session client and the organization graph,
 * both of which ADR-004 seals off from a feature-web package. The host answers
 * the same two facts, and they are read here once rather than at each of the
 * twenty-odd call sites, so a screen module keeps the shape it had.
 *
 * `project` is `undefined` until a project is in scope, which is what the
 * application hook did and what every caller already handles: a prompt belongs
 * to a project, and the screen renders its empty shell without one.
 */

import { useMemo } from "react";
import { usePromptHost } from "../model/prompt-host";

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
