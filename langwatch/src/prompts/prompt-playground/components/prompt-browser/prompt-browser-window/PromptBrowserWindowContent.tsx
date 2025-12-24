import { Box, VStack } from "@chakra-ui/react";
import cloneDeep from "lodash.clonedeep";
import debounce from "lodash.debounce";
import { useEffect, useMemo } from "react";
import { type DeepPartial, FormProvider } from "react-hook-form";
import { usePromptConfigForm } from "~/prompts/hooks";
import {
  type TabData,
  useDraggableTabsBrowserStore,
} from "~/prompts/prompt-playground/prompt-playground-store/DraggableTabsBrowserStore";
import type { PromptConfigFormValues } from "~/prompts/types";
import { useTabId } from "../ui/TabContext";
import { PromptBrowserHeader } from "./PromptBrowserHeader";
import { PromptMessagesEditor } from "./PromptMessagesEditor";
import { PromptTabbedSection } from "./PromptTabbedSection";

export { useTabId } from "../ui/TabContext";

/**
 * Window content for a prompt tab.
 * Single Responsibility: Initialize form for the active tab and render header, messages, and tabbed sections.
 * @returns JSX element or null when no initial values.
 */
export function PromptBrowserWindowContent() {
  const tabId = useTabId();
  const tab = useDraggableTabsBrowserStore(({ windows }) =>
    windows.flatMap((w) => w.tabs).find((t) => t.id === tabId),
  );
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
  const { updateTabData } = useDraggableTabsBrowserStore(
    ({ updateTabData }) => ({
      updateTabData,
    }),
  );

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
        <VStack paddingX={3} gap={3} width="full">
          <Box width="full" maxWidth="768px" margin="0 auto">
            <PromptBrowserHeader />
          </Box>
          <Box paddingBottom={2} width="full" maxWidth="768px" margin="0 auto">
            <PromptMessagesEditor />
          </Box>
        </VStack>
        <PromptTabbedSection />
      </VStack>
    </FormProvider>
  );
}
