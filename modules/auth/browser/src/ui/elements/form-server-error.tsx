import type { Control, FieldValues } from "react-hook-form";
import { useFormState } from "react-hook-form";

import { FORM_SERVER_ERROR_KEY } from "../../model/apply-handled-error-to-form.ts";
import { HandledErrorAlert } from "./handled-error-alert.tsx";

export interface FormServerErrorProps<TFieldValues extends FieldValues> {
  form: { control: Control<TFieldValues> };
}

/** Form-level server error; field-level errors show next to fields. */
export function FormServerError<TFieldValues extends FieldValues>({
  form,
}: FormServerErrorProps<TFieldValues>) {
  // `useFormState` subscribes this component to the control directly. Reading
  // `form.formState` here works only while the parent happens to re-render —
  // memoise this component, or move it to a sibling that doesn't own the
  // form, and a rejected submit would silently render nothing.
  const { errors } = useFormState({ control: form.control });
  // Read through the same constant `applyHandledErrorToForm` writes to, so
  // the two can never drift apart silently.
  const message = (errors.root as Record<string, { message?: string }> | undefined)?.[
    FORM_SERVER_ERROR_KEY
  ]?.message;
  if (!message) return null;

  return <HandledErrorAlert title="Check your details" description={message} />;
}
