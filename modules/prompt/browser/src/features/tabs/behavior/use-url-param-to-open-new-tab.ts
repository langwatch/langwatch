import { promptClient } from "@langwatch/prompt-client";
import { useEffect, useRef } from "react";

import { usePromptProject } from "../../../behavior/use-prompt-project.ts";
import { computeInitialFormValuesForPrompt } from "../../../model/prompt-form/index.ts";
import { usePromptHost } from "../../../model/prompt-host.ts";
import { usePromptDefaultModel } from "../../model-selection/behavior/use-prompt-default-model.ts";
import { useDraggableTabsBrowserStore } from "./use-prompt-tabs-browser-store.ts";

/** `?promptId=` - the address that opens one prompt in a new tab; read, never mirrored. */
function usePromptIdQueryParam() {
  const host = usePromptHost();
  const selectedPromptId = host.route().query.promptId ?? null;
  return { selectedPromptId };
}

/**
 * Opens the prompt named by `?promptId=` in a new tab, or focuses the tab
 * already holding it (a reload restores tabs before the link is read again).
 */
export function useUrlParamToOpenNewTab() {
  const { project } = usePromptProject();
  const addTab = useDraggableTabsBrowserStore((state) => state.addTab);
  const focusTabByConfigId = useDraggableTabsBrowserStore((state) => state.focusTabByConfigId);
  const { selectedPromptId } = usePromptIdQueryParam();
  const trpc = promptClient.useUtils();

  // Cascade-resolved model for new prompts. The query subscribes lazily
  // so the effect can read the cached value without firing a second
  // request when the URL changes.
  const resolvedDefault = usePromptDefaultModel();
  const resolvedDefaultModel = resolvedDefault.data?.model;
  // One link opens one tab: the effect re-runs when the default model arrives.
  const opened = useRef<string | null>(null);

  useEffect(() => {
    async function openNewTab() {
      if (!selectedPromptId || !project?.id || opened.current === selectedPromptId) return;
      opened.current = selectedPromptId;

      const prompt = await trpc.prompts.getByIdOrHandle.fetch({
        idOrHandle: selectedPromptId,
        projectId: project.id,
      });

      if (!prompt) return;

      const defaultValues = computeInitialFormValuesForPrompt({
        prompt: prompt,
        defaultModel: resolvedDefaultModel,
        useSystemMessage: true,
      });

      // The link stays in the URL to be shared, so a reload focuses its tab.
      if (defaultValues.configId && focusTabByConfigId({ configId: defaultValues.configId })) {
        return;
      }

      addTab({
        data: {
          chat: {
            initialMessagesFromSpanData: [],
          },
          form: {
            currentValues: defaultValues,
          },
          meta: {
            title: defaultValues.handle ?? null,
            versionNumber: defaultValues.versionMetadata?.versionNumber,
            scope: defaultValues.scope,
          },
          variableValues: {},
        },
      });
    }

    // A failure here is a prompt that will not open; the reader sees the tab
    // never arrive, which is the same thing the application's log line said.
    void openNewTab().catch(() => undefined);
  }, [
    addTab,
    focusTabByConfigId,
    resolvedDefaultModel,
    project?.id,
    selectedPromptId,
    trpc.prompts.getByIdOrHandle,
  ]);
}
