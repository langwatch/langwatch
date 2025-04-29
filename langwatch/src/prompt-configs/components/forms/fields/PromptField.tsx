import { Field, Textarea } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";

import type { PromptConfigFormValues } from "../../hooks/usePromptConfigForm";

export function PromptField() {
  const form = useFormContext<PromptConfigFormValues>();
  const { register, formState } = form;
  const { errors } = formState;

  return (
    <Field.Root invalid={!!errors.version?.configData?.prompt}>
      <Field.Label>Prompt</Field.Label>
      <Textarea
        {...register("version.configData.prompt")}
        placeholder="You are a helpful assistant"
        rows={4}
      />
      {errors.version?.configData?.prompt && (
        <Field.ErrorText>
          {errors.version?.configData?.prompt.message}
        </Field.ErrorText>
      )}
    </Field.Root>
  );
}
