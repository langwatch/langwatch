import type { Control, FieldValues, Path, UseFormSetError } from "react-hook-form";

type FormErrorTarget<TFieldValues extends FieldValues> = {
  control: Control<TFieldValues>;
  setError: UseFormSetError<TFieldValues>;
};

import { readHandledError, safeProse } from "@langwatch/handled-error/read-handled-error";

/**
 * The key under `errors.root` this module writes form-level complaints to.
 */
export const FORM_SERVER_ERROR_KEY = "serverError";

/**
 * The root error key react-hook-form reserves for form-level (non-field)
 * errors. Rendered by `<FormServerError>`.
 */
export const FORM_SERVER_ERROR = `root.${FORM_SERVER_ERROR_KEY}`;

/**
 * Puts a rejected submission back on the form that caused it.
 */
export function applyHandledErrorToForm<TFieldValues extends FieldValues>({
  error,
  form,
  hasFormErrorSlot = false,
}: {
  error: unknown;
  form: FormErrorTarget<TFieldValues>;
  /**
   * Whether this form renders `<FormServerError form={form} />`.
   */
  hasFormErrorSlot?: boolean;
}): boolean {
  const handled = readHandledError(error);
  if (handled?.code !== "validation_error") return false;

  const fieldErrors = asFieldErrors(handled.meta.fieldErrors);
  const formErrors = asStringArray(handled.meta.formErrors);

  const nonEmpty = Object.entries(fieldErrors).filter(([, messages]) => messages.length > 0);
  const applicable = nonEmpty.filter((entry) => isPaintedField({ form, field: entry[0] }));

  // Only the errors this form can actually put on screen count towards claiming it. See
  // `hasFormErrorSlot`.
  const showableFormErrors = hasFormErrorSlot ? formErrors.slice(0, MAX_FORM_ERRORS) : [];

  // Whether the form can show the WHOLE rejection. When it can't, the caller
  // still toasts, so the parts this form can't display aren't lost.
  const claimsEverything =
    applicable.length === nonEmpty.length && showableFormErrors.length === formErrors.length;

  if (applicable.length === 0 && showableFormErrors.length === 0) return false;

  applicable.forEach(([field, messages], index) => {
    form.setError(
      field as Path<TFieldValues>,
      // Clamped, like every other sentence in this feature that we did not
      // author: these arrive on `meta`, and a relayed handled error's meta is
      // forwarded verbatim from an upstream response body.
      { type: "server", message: safeProse(messages[0] ?? "") },
      // Focus the first one so a rejection below the fold still lands — but
      // only when the form is the sole report. On a partial match a toast is
      // coming too, and yanking focus into a field while a toast explains a
      // different problem reads as two things fighting for attention.
      { shouldFocus: claimsEverything && index === 0 },
    );
  });

  if (showableFormErrors.length > 0) {
    form.setError(FORM_SERVER_ERROR as Path<TFieldValues>, {
      type: "server",
      message: safeProse(showableFormErrors.join(" ")),
    });
  }

  // Mark what it owns either way: a `projectId` complaint the user can't act
  // on shouldn't stop them seeing that `name` is the field that's wrong.
  return claimsEverything;
}

/** More than this above a form is a document, not a rejection. */
const MAX_FORM_ERRORS = 4;

/**
 * Whether an input is actually on screen for this key.
 */
function isPaintedField<TFieldValues extends FieldValues>({
  form,
  field,
}: {
  form: FormErrorTarget<TFieldValues>;
  field: string;
}): boolean {
  let node: unknown = (form.control as { _fields?: unknown })._fields;
  for (const segment of field.split(".")) {
    if (!node || typeof node !== "object") return false;
    node = (node as Record<string, unknown>)[segment];
  }
  return !!(node as { _f?: { ref?: unknown } } | undefined)?._f?.ref;
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
