/**
 * The feedback capability, over the Design System's toaster. A screen
 * hands over the raw error; the words are resolved HERE from its `code`
 * via `@langwatch/error-presentation/presentation` — never `error.message`.
 */

import { toaster } from "@langwatch/design-system/toaster";
import {
  explainHandledError,
  explainUnhandledError,
  UNKNOWN_ERROR_PRESENTATION,
} from "@langwatch/error-presentation/presentation";
import {
  readEnvelopeTraceId,
  readHandledError,
} from "@langwatch/error-presentation/read-handled-error";
import { isServerUnreachable } from "@langwatch/handled-error/is-server-unreachable";

import { UiFeedback, type UiFailureNotice, type UiSuccessNotice } from "./capabilities.ts";
import { isHandledByGlobalHandler } from "./errors.ts";
import { isUiNavigatingAway } from "./navigation.ts";

/** How long a failure stays up: long enough to read it and copy the error id. */
const FAILURE_DURATION_MS = 12_000;

/**
 * What we say when nothing answered at all — said as a WAIT rather than a fault: a deploy
 * rolling, a laptop waking, a server still coming up. The generic "We've been notified" line is
 * a promise nobody kept, since the request never left the browser.
 */

/**
 * The screen's own title is dropped with it: it names the action, and the action is not what
 * went wrong.
 */
const SERVER_UNREACHABLE_COPY = {
  title: "Waiting for LangWatch",
  description: "We can't reach the server right now. Check your connection, then try again.",
} as const;

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
 * The words for one failure: registry when it knows the code, the
 * screen's `fallbackTitle`/`description` only fill the gap when there is
 * no code to look up — the registry always wins where it has an answer.
 */
export function resolveUiFailureCopy({
  error,
  fallbackTitle,
  title,
  description,
}: UiFailureNotice): ResolvedUiFailureCopy {
  // NOTHING ANSWERED: deliberately AHEAD of the registry, which answers "which
  // refusal was this" — this answers whether we were refused at all.
  // `isServerUnreachable` is conservative by construction, so a named refusal
  // can never be repainted as this.
  if (isServerUnreachable(error)) {
    return {
      title: SERVER_UNREACHABLE_COPY.title,
      description: SERVER_UNREACHABLE_COPY.description,
      docsUrl: void 0,
      traceId: void 0,
    };
  }

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
 * The toast's single body line: the registry's description plus the one
 * remaining tip that adds something — a toast has room for one; an inline
 * alert, once that surface exists, is where the rest belong.
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
 * Compared on a normalised form (lower-cased, punctuation flattened),
 * since a tip is never character-identical to the description it
 * overlaps — e.g. `query_timeout`'s tip repeats part of its description.
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
     * The one way out, in the Design System toast's own shape — it draws
     * the trigger and dismisses on click. `UiFailureAction` says `run`;
     * this says `onClick`; the rename happens here, not in the port.
     */
    action?: { label: string; onClick: () => void };
  }) => unknown;
};

export class BrowserUiFeedback extends UiFeedback {
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
    // A failure an installed interceptor already answered — a licence limit
    // that opened the upgrade dialog, say — is reported. A toast on top of it
    // is a second, weaker account of the same refusal. `showErrorToast` asks
    // the same question for the screens that report through it; this door is
    // for the hosts a feature reports through directly.
    if (isHandledByGlobalHandler(failure.error)) return;

    // ON THE WAY OUT. A request the unload aborted looks exactly like a server
    // that never answered, so without this a sign-out or a post-accept redirect
    // toasts "we cannot reach the server" over the top of the page the reader
    // is already being taken to. Only the unreachable shape is suppressed: a
    // refusal that DID arrive still has something to say.
    if (isUiNavigatingAway() && isServerUnreachable(failure.error)) return;

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
      // Read by the toaster's `renderMeta` (see `shell/ui-error-actions`):
      // the docs link and the copyable error id, which is the whole of the
      // technical detail a customer is shown.
      meta: { docsUrl: copy.docsUrl, traceId: copy.traceId },
    });
  }
}
