import { HStack, Button, Spinner, Text, Input } from "@chakra-ui/react";
import { FormProvider } from "react-hook-form";
import { PromptNameField } from "./fields/PromptNameField";
import { VersionHistoryListPopover } from "../VersionHistoryListPopover";
import { SaveIcon } from "lucide-react";
import { usePromptConfigForm } from "../hooks/usePromptConfigForm";
import { PromptConfigVersionFieldGroup } from "./fields/PromptConfigVersionFieldGroup";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { DemonstrationsField } from "./fields/DemonstrationsField";

interface PromptConfigFormProps {
  configId: string;
}

export function PromptConfigForm({ configId }: PromptConfigFormProps) {
  const { methods, handleSubmit, isLoading, isSubmitting } =
    usePromptConfigForm({
      configId,
    });

  const { register, formState } = methods;
  const { errors } = formState;

  if (isLoading) {
    return null;
  }

  const formIsDirty = methods.formState.isDirty;

  return (
    <FormProvider {...methods}>
      <form>
        <PromptNameField />
        <PromptConfigVersionFieldGroup />
        <DemonstrationsField />

        {/* Manage the commit message and saving */}
        <VerticalFormControl
          label={
            <HStack justify="space-between" width="full">
              <Text>Description</Text>
              <VersionHistoryListPopover configId={configId} />
            </HStack>
          }
          invalid={!!errors.version?.commitMessage}
          helper={errors.version?.commitMessage?.message?.toString()}
          error={errors.version?.commitMessage}
          borderTopWidth={1}
        >
          <HStack>
            <Input
              placeholder="Enter a description for this version"
              {...register("version.commitMessage")}
            />
            <Button
              type="submit"
              colorPalette={formIsDirty ? "orange" : "gray"}
              aria-label="Save"
              disabled={!formIsDirty}
              onClick={(e) => {
                e.preventDefault();
                handleSubmit();
              }}
            >
              {isSubmitting ? <Spinner /> : <SaveIcon />}
              Save Version
            </Button>
          </HStack>
        </VerticalFormControl>
      </form>
    </FormProvider>
  );
}
