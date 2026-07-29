// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { ValidationError } from "@langwatch/handled-error";

/**
 * "That isn't one of the values this field takes", said once.
 *
 * The activity-monitor services are deliberately reachable from more than the
 * tRPC routers — background workers and webhook adapters call `createSource`
 * and `createRule` directly, and the routers' zod enums do not protect those
 * callers. So every enum guard in this directory has to reject on its own,
 * and each rejection is the same kind of thing: exactly-known cause, and one
 * action that fixes it (pick a listed value).
 *
 * That makes it a `ValidationError`, not a plain `Error`. As a plain `Error`
 * these reached the customer as "Something went wrong — we've been notified"
 * *and* booked a 5xx incident for what is a typo.
 *
 * The complaint travels in `meta.formErrors` because that is the half of the
 * `validation_error` contract something actually reads: the registry entry
 * renders the first `formErrors` string when the field name isn't one it
 * knows how to name (`presentation.ts`, `USER_VISIBLE_FIELDS`), and none of
 * these field names are. There is no `fieldErrors` half — these surfaces are
 * `useState` composers, not `react-hook-form`, so nothing calls
 * `applyHandledErrorToForm` and nothing would read it.
 */
export function unsupportedValue({
  field,
  value,
  allowed,
}: {
  field: string;
  value: string;
  allowed: readonly string[];
}): ValidationError {
  const complaint = `Unsupported ${field} "${value}". Allowed: ${allowed.join(", ")}.`;
  return new ValidationError(complaint, {
    meta: { formErrors: [complaint] },
  });
}
