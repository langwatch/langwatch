import { VStack } from "@chakra-ui/react";
import { PromptBrowserHeader } from "./PromptBrowserHeader";
import { PromptMessagesEditor } from "./PromptMessagesEditor";
import { PromptTabbedSection } from "./PromptTabbedSection";
import { usePromptConfigForm } from "~/prompt-configs/hooks";
import { FormProvider } from "react-hook-form";
import { usePromptQueryForFormValues } from "~/prompt-configs/hooks/usePromptQueryForFormValues";

interface PromptBrowserWindowProps {
  configId?: string;
}

export function PromptBrowserWindow(props: PromptBrowserWindowProps) {
  const { initialConfigValues } = usePromptQueryForFormValues({
    configId: props.configId,
    useSystemMessage: true,
  });
  const form = usePromptConfigForm({
    configId: props.configId,
    initialConfigValues,
  });

  return (
    <VStack height="full" width="full" p={3}>
      <FormProvider {...form.methods}>
        <PromptBrowserHeader />
        <PromptMessagesEditor />
        <PromptTabbedSection />
      </FormProvider>
    </VStack>
  );
}
