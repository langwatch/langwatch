import { Alert } from "@chakra-ui/react";
import type { Control, FieldValues } from "react-hook-form";
import { useFormState } from "react-hook-form";

import { FORM_SERVER_ERROR_KEY } from "../../../behavior/errors/logic/apply-handled-error-to-form";

export interface FormServerErrorProps<TFieldValues extends FieldValues> {
  form: { control: Control<TFieldValues> };
}

/**
 * Renders the form-level rejection that `applyHandledErrorToForm` set.
 */
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

  return (
    // Chakra v3's `Alert.Root` is a plain div, so without this a rejected Save
    // is announced to nobody: the submit button stays put, the page doesn't
    // move, and a screen-reader user gets silence. `<HandledErrorAlert>` sets
    // the same role for the same reason.
    <Alert.Root role="alert" status="error" size="sm">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{message}</Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
