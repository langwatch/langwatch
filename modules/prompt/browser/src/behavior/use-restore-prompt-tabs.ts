/**
 * Tabs kept across a reload hold only their prompt id (§10.2), so each comes
 * back loading and is read again here; a prompt that is gone closes its tab.
 * The fetch-then-fill shape is `useLoadSpanIntoPromptPlayground`'s.
 */

import { promptClient } from "@langwatch/prompt-client";
import { useEffect, useRef } from "react";

import { computeInitialFormValuesForPrompt } from "../model/prompt-form/index.ts";
import { usePromptHost } from "../model/prompt-host.ts";
import { usePromptProject } from "./use-prompt-project.ts";
import { useDraggableTabsBrowserStore } from "./use-prompt-tabs-browser-store.ts";

export function useRestorePromptTabs(): void {
  const host = usePromptHost();
  const { project } = usePromptProject();
  const trpc = promptClient.useUtils();
  const windows = useDraggableTabsBrowserStore((state) => state.windows);
  const updateTabData = useDraggableTabsBrowserStore((state) => state.updateTabData);
  const removeTab = useDraggableTabsBrowserStore((state) => state.removeTab);
  const asked = useRef(new Set<string>());

  useEffect(() => {
    const projectId = project?.id;
    if (!projectId) return;
    for (const tab of windows.flatMap((w) => w.tabs)) {
      const configId = tab.data.form.currentValues?.configId;
      if (!tab.data.loading || !configId || asked.current.has(tab.id)) continue;
      asked.current.add(tab.id);
      void (async () => {
        try {
          const prompt = await trpc.prompts.getByIdOrHandle.fetch({
            idOrHandle: configId,
            projectId,
            version: tab.data.meta.versionNumber,
          });
          if (!prompt) {
            removeTab({ tabId: tab.id });
            return;
          }
          const currentValues = computeInitialFormValuesForPrompt({
            prompt,
            useSystemMessage: true,
          });
          updateTabData({
            tabId: tab.id,
            updater: (data) => ({
              ...data,
              loading: false,
              form: { currentValues },
              meta: { ...data.meta, title: currentValues.handle ?? null, versionNumber: prompt.version },
            }),
          });
        } catch (error) {
          removeTab({ tabId: tab.id });
          host.failed({ error, fallbackTitle: "Couldn't reopen this prompt tab" });
        }
      })();
    }
  }, [windows, project?.id, trpc, updateTabData, removeTab, host]);
}
