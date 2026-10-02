import { useState } from "react";
import { showErrorToast } from "~/features/errors";
import { RoleBindingScopeType, TeamUserRole } from "~/generated/prisma/client";
import { api } from "~/utils/api";

/**
 * Default name of a key minted from a setup surface. People who want their
 * own name, a narrower scope or an expiry create the key from Settings > API
 * Keys instead.
 */
const DEFAULT_KEY_NAME = "Initial API key";

/**
 * Project-level MEMBER: read and write within the project, nothing else. The
 * goal is one-click provisioning for snippets and setup guides, so there is
 * no scope picker here.
 */
function projectMemberBindings(projectId: string) {
  return [
    {
      role: TeamUserRole.MEMBER,
      scopeType: RoleBindingScopeType.PROJECT,
      scopeId: projectId,
    },
  ];
}

/**
 * Mints a personal API key bound to one project, for a surface that shows a
 * setup snippet. The project's own key is stored as a hash and can never be
 * shown, so any snippet that needs a real key fills it from here. The token
 * is returned by the create call only, so it lives in the caller's state for
 * the session and is never fetched again.
 *
 * Pass `token` / `onToken` to lift the token into a parent (for example the
 * onboarding context, so every tab shares one key); otherwise the hook holds
 * it itself.
 */
export function useMintProjectApiKey({
  organizationId,
  projectId,
  name = DEFAULT_KEY_NAME,
  token: liftedToken,
  onToken,
}: {
  organizationId: string | undefined;
  projectId: string | undefined;
  name?: string;
  token?: string | null;
  onToken?: (token: string) => void;
}): {
  token: string | null;
  mint: () => void;
  isPending: boolean;
  canMint: boolean;
} {
  const [ownToken, setOwnToken] = useState<string | null>(null);
  const createMutation = api.apiKey.create.useMutation();
  const isLifted = liftedToken !== undefined || onToken !== undefined;
  const token = isLifted ? (liftedToken ?? null) : ownToken;
  const canMint = !!organizationId && !!projectId;

  const mint = () => {
    if (!organizationId || !projectId) return;
    createMutation.mutate(
      {
        organizationId,
        name,
        bindings: projectMemberBindings(projectId),
      },
      {
        onSuccess: (result) => {
          if (isLifted) onToken?.(result.token);
          else setOwnToken(result.token);
        },
        onError: (error) =>
          showErrorToast({ error, fallbackTitle: "Couldn't create API key" }),
      },
    );
  };

  return { token, mint, isPending: createMutation.isPending, canMint };
}
