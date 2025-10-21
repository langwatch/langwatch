import { VStack } from "@chakra-ui/react";
import { PromptBrowserHeader } from "./PromptBrowserHeader";
import { PromptMessagesEditor } from "./PromptMessagesEditor";
import { PromptTabbedSection } from "./PromptTabbedSection";
import { usePromptConfigForm } from "~/prompt-configs/hooks";
import { FormProvider } from "react-hook-form";
import { usePromptQueryForFormValues } from "~/prompt-configs/hooks/usePromptQueryForFormValues";
import type { PromptConfigFormValues } from "~/prompt-configs/types";

interface PromptBrowserWindowContentProps {
  configId?: string;
}

/**
 * Main component of the prompt browser window content.
 */
export function PromptBrowserWindowContent(
  props: PromptBrowserWindowContentProps,
) {
  const { initialConfigValues } = usePromptQueryForFormValues({
    configId: props.configId,
    useSystemMessage: true,
  });

  /**
   * If the prompt is not found, don't render the window.
   */
  if (!initialConfigValues) return null;

  return (
    <PromptBrowserWindowInner
      configId={props.configId}
      initialConfigValues={initialConfigValues}
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
}) {
  const form = usePromptConfigForm(props);

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
