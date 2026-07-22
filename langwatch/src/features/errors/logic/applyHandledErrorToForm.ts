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
 * including a `validation_error` whose fields don't exist on this form, which
 * would otherwise be silently swallowed.
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

  // Only claim fields this form actually renders. Two traps here, both of
  // which end with the user staring at a clean form and a save that didn't
  // happen:
  //
  //   - zod's flatten() collapses a nested path (["version","configData"]) to
  //     its head, so a top-level key check says "yes, I own `version`" and
  //     sets an error on a container no input is registered against. Nothing
  //     renders it and shouldFocus finds no ref.
  //   - a field that is in the schema but not currently mounted is absent
  //     from getValues().
  //
  // So test against a leaf value, not just a key.
  const values = form.getValues() as Record<string, unknown>;
  const ownsLeaf = (field: string) =>
    Object.hasOwn(values, field) && !isPlainContainer(values[field]);

  const nonEmpty = Object.entries(fieldErrors).filter(
    ([, messages]) => messages.length > 0,
  );
  const applicable = nonEmpty.filter(([field]) => ownsLeaf(field));

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

/** An object/array value — a container, not something an input binds to. */
function isPlainContainer(value: unknown): boolean {
  return typeof value === "object" && value !== null;
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
