import { useEffect, useMemo } from "react";
import { Box, VStack } from "@chakra-ui/react";
import { PromptBrowserHeader } from "./PromptBrowserHeader";
import { PromptMessagesEditor } from "./PromptMessagesEditor";
import { PromptTabbedSection } from "./PromptTabbedSection";
import { usePromptConfigForm } from "~/prompt-configs/hooks";
import { FormProvider } from "react-hook-form";
import {
  useDraggableTabsBrowserStore,
  type TabData,
} from "~/prompt-configs/prompt-studio/prompt-studio-store/DraggableTabsBrowserStore";
import type { PromptConfigFormValues } from "~/prompt-configs/types";
import debounce from "lodash/debounce";
import { cloneDeep } from "lodash";
import { useTabId } from "../ui/TabContext";

export { useTabId } from "../ui/TabContext";

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
      initialConfigValues={initialConfigValues as PromptConfigFormValues}
      tabId={tabId}
    />
  );
}

function PromptBrowserWindowInner(props: {
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

  form.methods.watch((values) => {
    updateTabDataDebounced({
      tabId: props.tabId,
      updater: (data: TabData) => ({
        ...data,
        form: {
          currentValues: cloneDeep(values),
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
