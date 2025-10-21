import { useEffect } from "react";
import { VStack } from "@chakra-ui/react";
import { PromptBrowserHeader } from "./PromptBrowserHeader";
import { PromptMessagesEditor } from "./PromptMessagesEditor";
import { PromptTabbedSection } from "./PromptTabbedSection";
import { usePromptConfigForm } from "~/prompt-configs/hooks";
import { FormProvider } from "react-hook-form";
import { useDraggableTabsBrowserStore } from "~/prompt-configs/prompt-studio/prompt-studio-store/DraggableTabsBrowserStore";
import type { PromptConfigFormValues } from "~/prompt-configs/types";

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
  const initialConfigValues = tab?.data.form.defaultValues;

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

  // Handle syncing the form-derived metadata to the tab data (live title/version)
  form.methods.watch((values) => {
    updateTabData({
      tabId: props.tabId,
      updater: (data) => ({
        ...data,
        meta: {
          ...data.meta,
          title: values.handle ?? null,
          versionNumber: values.versionMetadata?.versionNumber,
        },
      }),
    });
  });

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
      <VStack height="full" width="full" p={3}>
        <PromptBrowserHeader />
        <PromptMessagesEditor />
        <PromptTabbedSection />
      </VStack>
    </FormProvider>
  );
}
