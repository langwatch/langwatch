import { HStack, Button, Spinner, Text, Input } from "@chakra-ui/react";
import { SaveIcon } from "lucide-react";
import { FormProvider } from "react-hook-form";

import { type usePromptConfigForm } from "../hooks/usePromptConfigForm";
import { VersionHistoryListPopover } from "../VersionHistoryListPopover";

import { DemonstrationsField } from "./fields/DemonstrationsField";
import { PromptConfigVersionFieldGroup } from "./fields/PromptConfigVersionFieldGroup";
import { PromptNameField } from "./fields/PromptNameField";

import { VerticalFormControl } from "~/components/VerticalFormControl";

type PromptConfigFormProps = ReturnType<typeof usePromptConfigForm>;

export function PromptConfigForm(formProps: PromptConfigFormProps) {
  const { methods, handleSubmit, isSubmitting, configId } = formProps;
  const { register, formState } = methods;
  const { errors } = formState;
  const formIsDirty = methods.formState.isDirty;

  return (
    <FormProvider {...methods}>
      <form style={{ width: "100%" }}>
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
