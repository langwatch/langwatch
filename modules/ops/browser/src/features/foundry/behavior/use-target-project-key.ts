import { apiKeyClient, personalTokenInput } from "@langwatch/api-key-client";
import { useOptionalUiCapabilities } from "@langwatch/browser-host/capabilities";
import { useRef } from "react";

import { useShowErrorToast } from "../../../behavior/ops-feedback.ts";
import { useFoundryProjectStore } from "./foundry-project.store.ts";
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
    const store = useFoundryProjectStore.getState();
    // Held as a promise, so a second send while the first mint is in flight joins it.
    const held =
      store.heldToken?.scopeKey === scopeKey
        ? store.heldToken
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
    store.holdToken(held);
    try {
      const token = await held.token;
      return currentScope.current === scopeKey ? token : void 0;
    } catch (error) {
      if (useFoundryProjectStore.getState().heldToken === held) store.holdToken(null);
      showErrorToast({ error, fallbackTitle: "Couldn't create the personal access token" });
      return void 0;
    }
  }

  return { project, mintApiKey };
}
