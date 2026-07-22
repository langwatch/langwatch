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
 *   showErrorToast({ error, fallbackTitle: "Couldn't save" });
 * },
 * ```
 *
 * Returns `false` for anything that isn't a field-level validation failure —
 * including a `validation_error` naming fields this form doesn't paint an
 * input for, which would otherwise be silently swallowed.
 */
export function applyHandledErrorToForm<TFieldValues extends FieldValues>({
  error,
  form,
  hasFormErrorSlot = false,
}: {
  error: unknown;
  form: UseFormReturn<TFieldValues>;
  /**
   * Whether this form renders `<FormServerError form={form} />`.
   *
   * Form-level complaints (`meta.formErrors`) have nowhere to go on a form
   * that doesn't render the root slot: `setError("root.serverError")` succeeds,
   * nothing displays it, and claiming the error suppresses the caller's toast
   * — so the user clicks Save and absolutely nothing happens. That is strictly
   * worse than the raw-message toast this module set out to replace, so the
   * default is the safe one: don't claim what you can't show.
   */
  hasFormErrorSlot?: boolean;
}): boolean {
  const handled = readHandledError(error);
  if (handled?.code !== "validation_error") return false;

  const fieldErrors = asFieldErrors(handled.meta.fieldErrors);
  const formErrors = asStringArray(handled.meta.formErrors);

  const nonEmpty = Object.entries(fieldErrors).filter(
    ([, messages]) => messages.length > 0,
  );
  const applicable = nonEmpty.filter((entry) =>
    isPaintedField({ form, field: entry[0] }),
  );

  // Only the errors this form can actually put on screen count towards
  // claiming it. See `hasFormErrorSlot`.
  const showableFormErrors = hasFormErrorSlot ? formErrors : [];

  // Whether the form can show the WHOLE rejection. When it can't, the caller
  // still toasts, so the parts this form can't display aren't lost.
  const claimsEverything =
    applicable.length === nonEmpty.length &&
    showableFormErrors.length === formErrors.length;

  if (applicable.length === 0 && showableFormErrors.length === 0) return false;

  applicable.forEach(([field, messages], index) => {
    form.setError(
      field as Path<TFieldValues>,
      { type: "server", message: messages[0] },
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
      message: showableFormErrors.join(" "),
    });
  }

  // Mark what it owns either way: a `projectId` complaint the user can't act
  // on shouldn't stop them seeing that `name` is the field that's wrong.
  return claimsEverything;
}

/**
 * Whether an input is actually on screen for this key.
 *
 * The question is "can this form SHOW the complaint", and only react-hook-form
 * knows: it records a `_f` descriptor with a live `ref` for each field an
 * input registered and mounted. Asking `getValues()` instead answered a
 * different question — it returns every key in the form's values, including
 * defaults for fields no input paints — so the bridge could claim an error,
 * set it on a key with nothing rendering it, and return `true`, suppressing
 * the caller's toast. The user pressed Save and nothing at all happened.
 * (One call site had already worked around this by hand.)
 *
 * This also settles two cases the value-shape check got wrong by construction:
 *
 *   - zod's flatten() collapses a nested path (["version","configData"]) to
 *     its head, and `_fields.version` is a plain branch with no `_f` — so a
 *     container is declined, without inspecting any value.
 *   - a multi-select registered as ONE input holds an array value and is
 *     perfectly renderable; ownership follows registration, not the shape of
 *     what happens to be in the field.
 *
 * Reading `control._fields` is reaching past the public API, deliberately:
 * `getFieldState` reports validation state, not whether anything is mounted,
 * and there is no public "is this registered" question. The failure mode if
 * the internal moves is the safe one — nothing looks painted, so every error
 * falls through to the toast.
 */
function isPaintedField<TFieldValues extends FieldValues>({
  form,
  field,
}: {
  form: UseFormReturn<TFieldValues>;
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
