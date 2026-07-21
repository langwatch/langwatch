import type { FieldValues, Path, UseFormReturn } from "react-hook-form";

import { readHandledError } from "./readHandledError";

/**
 * The root error key react-hook-form reserves for form-level (non-field)
 * errors. Rendered by `<FormServerError>`.
 */
export const FORM_SERVER_ERROR = "root.serverError";

/**
 * Puts a rejected submission back on the form that caused it.
 *
 * A validation failure is the one error class that already has a place to live
 * — next to the field that's wrong. Showing it in a toast makes the user hunt
 * for what to change, and the toast is gone by the time they find it.
 *
 * Maps `meta.fieldErrors` onto their fields and `meta.formErrors` onto the
 * form root, then focuses the first offending field so the rejection is
 * unmissable even on a long form.
 *
 * Returns `true` when it consumed the error, so callers can skip the toast:
 *
 * ```ts
 * onError: (error) => {
 *   if (applyHandledErrorToForm({ error, form })) return;
 *   showErrorToast(error, { fallbackTitle: "Couldn't save" });
 * },
 * ```
 *
 * Returns `false` for anything that isn't a field-level validation failure —
 * including a `validation_error` whose fields don't exist on this form, which
 * would otherwise be silently swallowed.
 */
export function applyHandledErrorToForm<TFieldValues extends FieldValues>({
  error,
  form,
}: {
  error: unknown;
  form: UseFormReturn<TFieldValues>;
}): boolean {
  const handled = readHandledError(error);
  if (handled?.code !== "validation_error") return false;

  const fieldErrors = asFieldErrors(handled.meta.fieldErrors);
  const formErrors = asStringArray(handled.meta.formErrors);

  // Only claim fields this form actually owns. A `validation_error` from a
  // different shape (a nested payload, a server-side rule about something not
  // on screen) must fall through to the toast rather than vanish.
  const known = new Set(Object.keys(form.getValues()));
  const applicable = Object.entries(fieldErrors).filter(
    ([field, messages]) => known.has(field) && messages.length > 0,
  );

  if (applicable.length === 0 && formErrors.length === 0) return false;

  applicable.forEach(([field, messages], index) => {
    form.setError(
      field as Path<TFieldValues>,
      { type: "server", message: messages[0] },
      // Focus the first one so a rejection below the fold still lands.
      { shouldFocus: index === 0 },
    );
  });

  if (formErrors.length > 0) {
    form.setError(FORM_SERVER_ERROR as Path<TFieldValues>, {
      type: "server",
      message: formErrors.join(" "),
    });
  } else if (applicable.length === 0) {
    return false;
  }

  return true;
}

function asFieldErrors(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(value)) {
    const list = asStringArray(messages);
    if (list.length > 0) out[field] = list;
  }
  return out;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
