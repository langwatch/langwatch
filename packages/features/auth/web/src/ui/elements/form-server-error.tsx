import { Alert } from "@chakra-ui/react";
import type { Control, FieldValues } from "react-hook-form";
import { useFormState } from "react-hook-form";

import { FORM_SERVER_ERROR_KEY } from "../../model/apply-handled-error-to-form";

export interface FormServerErrorProps<TFieldValues extends FieldValues> {
  form: { control: Control<TFieldValues> };
}

/**
 * Renders the form-level rejection that `applyHandledErrorToForm` set.
 *
 * Field-level errors show next to their fields; this is for the ones that
 * belong to the submission as a whole. Put it at the top of the form so a
 * rejected submit is visible without scrolling — the point of the form bridge
 * is that the user can see the server said no, not just that a field went red
 * somewhere below the fold.
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
