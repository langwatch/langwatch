import { toaster } from "../../../blocks/toaster";
import { isHandledByGlobalHandler } from "../../../../behavior/trpc-error";

import { resolveErrorCopy } from "../../../../behavior/errors/logic/resolve-error-copy";

export interface ShowErrorToastOptions {
  /**
   * Headline for a failure we have no specific copy for.
   *
   * This is the option you almost always want. It names the action that
   * failed ("Couldn't create project") so an unrecognised or unhandled error
   * still says what the user was doing — but a code the registry knows keeps
   * its own, better title ("That name is taken"), because the specific fact
   * beats the generic one every time.
   */
  fallbackTitle?: string;
  /**
   * Hard override of the title, registry entry or not.
   *
   * Rare, and usually a smell: if the registry's copy is wrong for this code,
   * fix the registry rather than papering over it at one call site.
   */
  title?: string;
  /** Toast id, for deduping repeated failures of the same action. */
  id?: string;
}

/**
 * Shows any error to the user, correctly.
 *
 * This is the ONLY sanctioned way to toast an error. It exists because the
 * obvious thing — `toaster.create({ description: error.message })` — is wrong
 * in both directions: for a handled error the wire message is the code slug
 * (`validation_error`), and for an unhandled one the message can carry
 * internals. See `dev/docs/best_practices/error-handling.md`.
 *
 * Also absorbs the global-handler dedup check that ~137 call sites were
 * copy-pasting, so a license-limit error that already opened a modal doesn't
 * also toast.
 *
 * ```ts
 * onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't create project" }),
 * ```
 */
export function showErrorToast({
  error,
  ...options
}: ShowErrorToastOptions & { error: unknown }): void {
  // Already surfaced as a modal or a bespoke toast by the global interceptors
  // in `utils/api.tsx` — a second toast would be a duplicate report.
  if (isHandledByGlobalHandler(error)) return;

  // One parse, one set of rules — the same ones the inline alert renders.
  const copy = resolveErrorCopy({
    error,
    title: options.title,
    fallbackTitle: options.fallbackTitle,
  });

  toaster.create({
    ...(options.id ? { id: options.id } : {}),
    // The shared default is 5s, which is not long enough to read the copy,
    // decide, and click "Copy error ID" or "Read the docs".
    duration: 12000,
    title: copy.title,
    description: bodyCopy(copy),
    type: "error",
    meta: {
      // Consumed by the Toaster's error rendering — the docs link and the
      // copyable error id, which is all a customer gets of the technical
      // detail (raw meta and the reason chain stay server-side).
      docsUrl: copy.docsUrl,
      traceId: copy.traceId,
    },
  });
}

/**
 * The toast's single body line: the registry's description, plus the one
 * remaining server tip that adds something to it.
 *
 * `resolveErrorCopy` has already dropped any tip that merely restates the
 * description, so what is left is remediation the registry never said. Folding
 * one in is the difference between "We're on it. Try again in a moment." and
 * that plus "check the LangWatch status page or contact support" — the second
 * half being the only escalation path a customer is ever offered. A toast has
 * room for one, so the alert is where the rest live.
 */
function bodyCopy({
  description,
  tips,
}: {
  description: string;
  tips: readonly string[];
}): string {
  const tip = tips[0];
  if (!description) return tip ?? "";
  if (!tip) return description;

  return /[.!?]$/.test(description) ? `${description} ${tip}` : `${description}. ${tip}`;
}
