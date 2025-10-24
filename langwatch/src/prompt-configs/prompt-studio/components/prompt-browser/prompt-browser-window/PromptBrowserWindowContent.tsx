import { useEffect, useMemo } from "react";
import { Box, VStack } from "@chakra-ui/react";
import { PromptBrowserHeader } from "./PromptBrowserHeader";
import { PromptMessagesEditor } from "./PromptMessagesEditor";
import { PromptTabbedSection } from "./PromptTabbedSection";
import { usePromptConfigForm } from "~/prompt-configs/hooks";
import { FormProvider } from "react-hook-form";
import { useDraggableTabsBrowserStore } from "~/prompt-configs/prompt-studio/prompt-studio-store/DraggableTabsBrowserStore";
import type { PromptConfigFormValues } from "~/prompt-configs/types";
import debounce from "lodash/debounce";
import { cloneDeep } from "lodash";

interface PromptBrowserWindowContentProps {
  configId?: string;
  tabId: string;
}

/**
 * Main component of the prompt browser window content.
 */
export function PromptBrowserWindowContent(
  props: PromptBrowserWindowContentProps,
) {
  const { windows } = useDraggableTabsBrowserStore();
  const tab = windows.flatMap((w) => w.tabs).find((t) => t.id === props.tabId);
  const defaultValues = tab?.data.form.defaultValues;
  const initialConfigValues = useMemo(
    () => cloneDeep(defaultValues),
    [defaultValues],
  );

  /**
   * If the prompt is not found, don't render the window.
   */
  if (!initialConfigValues) return null;

  return (
    <PromptBrowserWindowInner
      configId={props.configId}
      initialConfigValues={initialConfigValues as PromptConfigFormValues}
      tabId={props.tabId}
    />
  );
}

/**
 * Inner component of the prompt browser window.
 * Allows a controlled form creation based on the initial config values.
 */
function PromptBrowserWindowInner(props: {
  configId?: string;
  initialConfigValues: PromptConfigFormValues;
  tabId: string;
}) {
  const form = usePromptConfigForm(props);
  const { updateTabData } = useDraggableTabsBrowserStore();

  const updateTabDataDebounced = useMemo(
    () => debounce(updateTabData, 500),
    [updateTabData],
  );

  const setValueDebounced = useMemo(
    () => debounce(form.methods.setValue, 500),
    [form.methods],
  );

  // Handle syncing the form-derived metadata to the tab data (live title/version)
  form.methods.watch((values) => {
    updateTabDataDebounced({
      tabId: props.tabId,
      updater: (data) => ({
        ...data,
        form: {
          ...data.form,
          // I don't love that we have to do this here as I think it affects performance.
          defaultValues: cloneDeep(values),
        },
        meta: {
          ...data.meta,
          title: values.handle ?? null,
          versionNumber: values.versionMetadata?.versionNumber,
          scope: values.scope,
        },
      }),
    });
  });

  // Handle syncing system message to prompt
  const messages = form.methods.watch("version.configData.messages");
  const systemMessage = useMemo(
    () => messages.find(({ role }) => role === "system")?.content,
    [messages],
  );
  useEffect(() => {
    if (systemMessage) {
      setValueDebounced("version.configData.prompt", systemMessage, {
        shouldDirty: false,
      });
    }
  }, [systemMessage, setValueDebounced]);

  useEffect(() => {
    const isDirty = form.methods.formState.isDirty;
    updateTabData({
      tabId: props.tabId,
      updater: (data) => ({
        ...data,
        form: {
          ...data.form,
          isDirty,
        },
      }),
    });
  }, [form.methods.formState.isDirty, props.tabId, updateTabData]);

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
