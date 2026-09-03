/**
 * The feedback capability, over the Design System's toaster.
 *
 * A screen never composes the sentence a customer reads for a failure: it hands
 * over the raw error and names the action that failed, and the words are
 * resolved HERE from the error's `code`. That split is the whole point of
 * `UiFailureNotice` — since #5984 the wire message of a handled error is the
 * code slug, so a screen that toasted `error.message` would print
 * `validation_error` at the customer.
 *
 * The words themselves come from `@langwatch/handled-error/presentation`, the code-keyed
 * registry (ADR-045, amendment 2026-07-21). This module used to carry a
 * four-entry copy table of its own because the registry had not moved yet; it
 * has, so the table is gone and every enumerated code — app, Go and node alike
 * — resolves to the copy a customer reads everywhere else. What is left here is
 * the three rules a TOAST applies on top of that registry:
 *
 *   1. Registry copy outranks the screen's `fallbackTitle`, because it names
 *      this exact failure where the fallback only names the action.
 *   2. A server remediation tip is folded in when it says something the
 *      registry description did not — a toast has room for one, and for
 *      `clickhouse_unavailable` that one is the only escalation path offered.
 *   3. A failure with no handled payload gets ADR-045's unknown state: the
 *      screen's own title, one calm generic line, and the trace id.
 */

import { toaster } from "@langwatch/design-system/toaster";
import {
  explainHandledError,
  explainUnhandledError,
  UNKNOWN_ERROR_PRESENTATION,
} from "@langwatch/handled-error/presentation";
import { readEnvelopeTraceId, readHandledError } from "@langwatch/handled-error/read-handled-error";
import { UiFeedbackPort, type UiFailureNotice, type UiSuccessNotice } from "./ui-capabilities";

/** How long a failure stays up: long enough to read it and copy the error id. */
const FAILURE_DURATION_MS = 12_000;

/** Everything a surface needs to render one failure, resolved once. */
export type ResolvedUiFailureCopy = {
  title: string;
  /**
   * The body line. Empty when a registered code's title says everything —
   * the registry's rule is that an empty description beats padding, so this
   * is deliberate silence rather than a gap to fill.
   */
  description: string;
  /** The canonical docs page, when the server named one. */
  docsUrl: string | undefined;
  /**
   * The trace id, and the ONLY technical detail a customer is offered. Raw
   * `meta` and the reason chain stay server-side (ADR-045).
   */
  traceId: string | undefined;
};

/**
 * The words for one failure: the registry's when it knows the code, the
 * screen's otherwise, and the generic unknown line when neither has anything.
 *
 * The registry WINS over a screen's own `fallbackTitle` and `description`,
 * which is the property that keeps a screen from talking over registered copy.
 * They only fill the gap where there is no code to look up at all.
 */
export function resolveUiFailureCopy({
  error,
  fallbackTitle,
  title,
  description,
}: UiFailureNotice): ResolvedUiFailureCopy {
  const handled = readHandledError(error);

  if (handled) {
    const explanation = explainHandledError(handled);
    const body = toastBody({
      description: explanation.description,
      tips: supplementalTips({ tips: handled.tips, description: explanation.description }),
    });

    return {
      // Registry copy outranks the screen's fallback, because it names this
      // exact failure where the fallback only names the action. An
      // unrecognised code has the opposite property, so the screen wins there
      // — and the humanised code stands behind both, for a screen that names
      // no action at all.
      title:
        title ??
        (explanation.isRegistered ? explanation.title : fallbackTitle || explanation.title),
      // A code the registry knows keeps its own answer, empty included. A code
      // it does not know has said nothing yet, so the screen's line — and
      // failing that the generic one — is what stands.
      description: explanation.isRegistered
        ? body
        : body || description || UNKNOWN_ERROR_PRESENTATION.description,
      docsUrl: handled.docsUrl,
      traceId: handled.traceId ?? readEnvelopeTraceId(error),
    };
  }

  // No handled payload: ADR-045's "unknown", which is a correct outcome rather
  // than a gap. The one thing still worth showing is prose a non-5xx procedure
  // authored itself — the boundary vouches for it with `data.authored`, and
  // replacing "You've already used this invite" with "we've been notified"
  // tells the reader to wait for something that will never change.
  return {
    title: title ?? (fallbackTitle || UNKNOWN_ERROR_PRESENTATION.title),
    description:
      explainUnhandledError(error).description ||
      description ||
      UNKNOWN_ERROR_PRESENTATION.description,
    docsUrl: void 0,
    traceId: readEnvelopeTraceId(error),
  };
}

/**
 * The toast's single body line: the registry's description, plus the one
 * remaining server tip that adds something to it.
 *
 * A toast has room for one tip; an inline alert, when that surface moves here,
 * is where the rest belong.
 */
function toastBody({
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

/**
 * The tips that add something the description did not already say.
 *
 * Compared on a normalised form — lower-cased, punctuation flattened — because
 * the two authorings are never character-identical: `query_timeout`'s registry
 * description is "Narrow the time range or add a filter, then try again." and
 * its first tip is "Narrow the time range". Dropping every tip whenever the
 * registry had ANY description threw the escalation path away instead.
 */
function supplementalTips({
  tips,
  description,
}: {
  tips: readonly string[];
  description: string;
}): readonly string[] {
  const target = normalise(description);
  if (!target) return tips;

  return tips.filter((tip) => {
    const candidate = normalise(tip);
    if (!candidate) return false;
    return !target.includes(candidate) && !candidate.includes(target);
  });
}

/** Words only: two sentences that say the same thing must compare equal. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The toaster this feedback is rendered on, so a test can record instead. */
export type UiToaster = {
  create: (toast: {
    id?: string;
    title: string;
    description?: string;
    type: string;
    duration?: number;
    meta?: Record<string, unknown>;
    /**
     * The one way out the failure offered, in the shape the Design System's
     * toast renders: it draws the trigger itself, in the status accent, and
     * dismisses the toast when the reader takes it.
     *
     * `UiFailureAction` says `run`; this says `onClick`. The rename is the
     * whole of the translation, and it happens here rather than in the port
     * because a port describes what happens and a toaster describes a click.
     */
    action?: { label: string; onClick: () => void };
  }) => unknown;
};

export class BrowserUiFeedback extends UiFeedbackPort {
  static create(target: UiToaster = toaster): BrowserUiFeedback {
    return new BrowserUiFeedback(target);
  }

  private constructor(private readonly target: UiToaster) {
    super();
  }

  succeeded({ title, description, id }: UiSuccessNotice): void {
    this.target.create({
      ...(id ? { id } : {}),
      title,
      ...(description ? { description } : {}),
      type: "success",
    });
  }

  failed(failure: UiFailureNotice): void {
    const copy = resolveUiFailureCopy(failure);
    this.target.create({
      ...(failure.id ? { id: failure.id } : {}),
      title: copy.title,
      ...(copy.description ? { description: copy.description } : {}),
      type: "error",
      duration: FAILURE_DURATION_MS,
      // The one way out, where the screen offered one. The Design System's
      // toast already draws this trigger — in the status accent, and
      // dismissing itself when the reader takes it — so the whole of the
      // translation is `run` becoming `onClick`.
      ...(failure.action
        ? { action: { label: failure.action.label, onClick: failure.action.run } }
        : {}),
      // Read by the toaster's `renderMeta` (see `ui/elements/ui-error-actions`):
      // the docs link and the copyable error id, which is the whole of the
      // technical detail a customer is shown.
      meta: { docsUrl: copy.docsUrl, traceId: copy.traceId },
    });
  }
}
