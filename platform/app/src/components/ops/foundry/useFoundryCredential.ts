import { useCallback } from "react";
import { RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useFoundryProjectStore } from "./foundryProjectStore";

const KEY_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * The project the Foundry sends traces to, and the credential it sends them
 * with. The first send to a project mints a personal API key that can only
 * create traces in that project and expires in a day; later sends in the same
 * session reuse it.
 */
export function useFoundryCredential(): {
  projectId: string | undefined;
  ensureApiKey: () => Promise<string>;
  isMinting: boolean;
} {
  const { project, organization } = useOrganizationTeamProject();
  const selectedTarget = useFoundryProjectStore((s) => s.selectedTarget);
  const keysByProject = useFoundryProjectStore((s) => s.keysByProject);
  const rememberKey = useFoundryProjectStore((s) => s.rememberKey);
  const createKey = api.apiKey.create.useMutation();

  const target =
    selectedTarget ??
    (project && organization
      ? { projectId: project.id, organizationId: organization.id }
      : null);

  const ensureApiKey = useCallback(async () => {
    if (!target) throw new Error("Select a project first");
    const existing = keysByProject[target.projectId];
    if (existing) return existing;

    const { token } = await createKey.mutateAsync({
      organizationId: target.organizationId,
      name: "Foundry",
      expiresAt: new Date(Date.now() + KEY_LIFETIME_MS),
      permissionMode: "restricted",
      permissions: ["traces:create"],
      bindings: [
        {
          role: TeamUserRole.CUSTOM,
          scopeType: RoleBindingScopeType.PROJECT,
          scopeId: target.projectId,
        },
      ],
    });
    rememberKey(target.projectId, token);
    return token;
  }, [target, keysByProject, createKey, rememberKey]);

  return {
    projectId: target?.projectId,
    ensureApiKey,
    isMinting: createKey.isPending,
  };
}
