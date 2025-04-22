import { FormProvider } from "react-hook-form";

import { type usePromptConfigForm } from "../hooks/usePromptConfigForm";

import { DemonstrationsField } from "./fields/DemonstrationsField";
import { PromptConfigVersionFieldGroup } from "./fields/PromptConfigVersionFieldGroup";
import { PromptNameField } from "./fields/PromptNameField";

type PromptConfigFormProps = ReturnType<typeof usePromptConfigForm>;

export function PromptConfigForm(formProps: PromptConfigFormProps) {
  const { methods } = formProps;

  return (
    <FormProvider {...methods}>
      <form style={{ width: "100%" }}>
        <PromptNameField />
        <PromptConfigVersionFieldGroup />
        <DemonstrationsField />
      </form>
    </FormProvider>
  );
}
