import { Field, Textarea } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";

import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";

import { VerticalFormControl } from "~/components/VerticalFormControl";

export function PromptField() {
  const form = useFormContext<PromptConfigFormValues>();
  const { register, formState } = form;
  const { errors } = formState;

  return (
    <VerticalFormControl
      label="Prompt"
      invalid={!!errors.version?.configData?.prompt}
      helper={errors.version?.configData?.prompt?.message?.toString()}
      error={errors.version?.configData?.prompt}
      size="sm"
    >
      <Textarea
        {...register("version.configData.prompt")}
        placeholder="You are a helpful assistant"
        autoresize
        maxHeight="33vh"
        rows={4}
      />
    </VerticalFormControl>
  );
}
