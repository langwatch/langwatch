import { useEffect, useMemo } from "react";
import { Box, VStack } from "@chakra-ui/react";
import { PromptBrowserHeader } from "./PromptBrowserHeader";
import { PromptMessagesEditor } from "./PromptMessagesEditor";
import { PromptTabbedSection } from "./PromptTabbedSection";
import { usePromptConfigForm } from "~/prompt-configs/hooks";
import { FormProvider, type DeepPartial } from "react-hook-form";
import {
  useDraggableTabsBrowserStore,
  type TabData,
} from "~/prompt-configs/prompt-studio/prompt-studio-store/DraggableTabsBrowserStore";
import type { PromptConfigFormValues } from "~/prompt-configs/types";
import debounce from "lodash/debounce";
import { cloneDeep } from "lodash";
import { useTabId } from "../ui/TabContext";
import { formSchema } from "~/prompt-configs/schemas/form-schema";

export { useTabId } from "../ui/TabContext";

/**
 * Window content for a prompt tab.
 * Single Responsibility: Initialize form for the active tab and render header, messages, and tabbed sections.
 * @returns JSX element or null when no initial values.
 */
export function PromptBrowserWindowContent() {
  const tabId = useTabId();
  const { windows } = useDraggableTabsBrowserStore();
  const tab = windows.flatMap((w) => w.tabs).find((t) => t.id === tabId);
  const currentValues = tab?.data.form.currentValues;
  const initialConfigValues = useMemo(
    () => cloneDeep(currentValues),
    [currentValues],
  );

  if (!initialConfigValues) return null;

  return (
    <PromptBrowserWindowInner
      initialConfigValues={initialConfigValues}
      tabId={tabId}
    />
  );
}

/**
 * PromptBrowserWindowInner component
 * Single Responsibility: Manages form state and syncs form changes with tab data.
 * @param props - Component props
 * @param props.initialConfigValues - Initial form values for the prompt configuration
 * @param props.tabId - ID of the tab to sync form data with
 */
function PromptBrowserWindowInner(props: {
  initialConfigValues: DeepPartial<PromptConfigFormValues>;
  tabId: string;
}) {
  const form = usePromptConfigForm(props);
  const { updateTabData } = useDraggableTabsBrowserStore();

  const updateTabDataDebounced = useMemo(
    () => debounce(updateTabData, 500),
    [updateTabData],
  );

  useEffect(() => {
    const sub = form.methods.watch((values) => {
      updateTabDataDebounced({
        tabId: props.tabId,
        updater: (data: TabData) => ({
          ...data,
          form: { currentValues: cloneDeep(values) },
          meta: {
            ...data.meta,
            title: values.handle ?? null,
            versionNumber: values.versionMetadata?.versionNumber,
            scope: values.scope,
          },
        }),
      });
    });
    return () => sub.unsubscribe();
  }, [form.methods, props.tabId, updateTabDataDebounced]);

  return (
    <FormProvider {...form.methods}>
      <VStack height="full" width="full" gap={3} paddingBottom={3}>
        <Box paddingX={3} width="full">
          <PromptBrowserHeader />
        </Box>
        <Box paddingX={3} width="full">
          <PromptMessagesEditor />
        </Box>
        <PromptTabbedSection />
      </VStack>
    </FormProvider>
  );
}
