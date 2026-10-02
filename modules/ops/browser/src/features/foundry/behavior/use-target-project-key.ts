import { apiKeyClient, personalTokenInput } from "@langwatch/api-key-client";
import { useOptionalUiCapabilities } from "@langwatch/browser-host/capabilities";
import { useRef } from "react";

import { useShowErrorToast } from "../../../behavior/ops-feedback.ts";
import { heldFoundryToken, holdFoundryToken } from "./foundry-project.store.ts";
import { useTargetProject } from "./use-target-project.ts";

/** The target project and an ingestion-only token for it, minted once per project and user. */
export function useTargetProjectKey() {
  const project = useTargetProject();
  const { mutateAsync, reset } = apiKeyClient.apiKey.create.useMutation({ gcTime: 0 });
  const showErrorToast = useShowErrorToast();
  const userId = useOptionalUiCapabilities()?.session.currentUser()?.id;
  const scopeKey = project ? `${project.organizationId}|${project.id}|${userId}` : undefined;
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;

  async function mintApiKey(): Promise<string | undefined> {
    if (!project || !scopeKey) return void 0;
    // Held as a promise, so a second send while the first mint is in flight joins it.
    const current = heldFoundryToken();
    const held =
      current?.scopeKey === scopeKey
        ? current
        : {
            scopeKey,
            token: mutateAsync(
              personalTokenInput({
                organizationId: project.organizationId,
                projectId: project.id,
                name: "Foundry personal access token",
              }),
            )
              .then((answer) => answer.token)
              .finally(() => reset()),
          };
    holdFoundryToken({ held });
    try {
      const token = await held.token;
      return currentScope.current === scopeKey ? token : void 0;
    } catch (error) {
      if (heldFoundryToken() === held) holdFoundryToken({ held: null });
      showErrorToast({ error, fallbackTitle: "Couldn't create the personal access token" });
      return void 0;
    }
  }

  return { project, mintApiKey };
}
