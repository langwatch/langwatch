import { Alert } from "@chakra-ui/react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

export interface FormServerErrorProps<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>;
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
  const message = form.formState.errors.root?.serverError?.message;
  if (!message) return null;

  return (
    <Alert.Root status="error" size="sm">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{message}</Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
