/**
 * The toast singleton every browser feature calls, routed to one port.
 */

import {
  type UiFailureNotice,
  type UiSuccessNotice,
  UiHostServiceUnavailableError,
} from "./capabilities.ts";

/**
 * Whatever answers a report — the application's feedback host service, or a
 * feature host that already answers the same questions.
 */
export type UiFeedbackSink = {
  succeeded(notice: UiSuccessNotice): void;
  warned(notice: UiSuccessNotice): void;
  informed(notice: UiSuccessNotice): void;
  failed(failure: UiFailureNotice): void;
};

export type UiToast = {
  /** A node, because a handful of call sites raise a title with a chip in it. */
  title?: unknown;
  /** Likewise: a few toasts carry an action button in their body. */
  description?: unknown;
  /**
   * The failure itself, for an `error` toast that has one. Handed to the host untouched,
   * because the code-keyed registry is what turns it into words.
   * notice degrades to its `title` plus ADR-045's unknown state.
   */
  error?: unknown;
  type?: "error" | "success" | "warning" | "info" | "loading";
  duration?: number;
  id?: string;
  meta?: unknown;
  placement?: string;
  action?: { label: string; onClick: () => void };
};

/**
 * The failure a copy-to-clipboard attempt reports when the browser refuses it, in the shape the
 * feedback host resolves through the code-keyed registry (`clipboard_unavailable`).
 */
export function clipboardUnavailableError(): { code: string; httpStatus: number } {
  return { code: "clipboard_unavailable", httpStatus: 0 };
}

let mounted: UiFeedbackSink | undefined;

/** Called by whatever mounts a feedback host, and cleared on unmount. */
export function setUiFeedbackHost(host: UiFeedbackSink | undefined): void {
  mounted = host;
}

/**
 * Runs one report against the mounted host. With no host, or only the unavailable stand-in
 * (which throws by design, to fail loudly in tests), the report is logged as a warning and
 * dropped: a screen reporting a failure from its own error handling must never throw out of it.
 */
function deliver({
  title,
  send,
}: {
  title: string;
  send: (host: UiFeedbackSink) => void;
}): boolean {
  if (!mounted) {
    console.warn("A toast was raised with no feedback host mounted:", title);
    return false;
  }
  try {
    send(mounted);
    return true;
  } catch (error) {
    if (!(error instanceof UiHostServiceUnavailableError)) throw error;
    console.warn("A toast was raised with no feedback host mounted:", title);
    return false;
  }
}

/** The host a report goes to, for the error module next door. */
export function currentUiFeedbackHost(): UiFeedbackSink | undefined {
  return mounted;
}

/**
 * The toast's headline as a string. The feedback port takes text and a few call sites raise a
 * node. A node degrades to the description where there is one — never `[object Object]` in
 * front of a customer.
 */
function title(toast: UiToast): string {
  if (typeof toast.title === "string") return toast.title;
  if (typeof toast.title === "number") return String(toast.title);
  return typeof toast.description === "string" ? toast.description : "";
}

/** An error toast, reported to the host as a failure so its words come from the registry. */
function createErrorToast(toast: UiToast): string | undefined {
  const delivered = deliver({
    title: title(toast),
    send: (host) =>
      host.failed({
        error: toast.error,
        fallbackTitle: title(toast),
        description: typeof toast.description === "string" ? toast.description : void 0,
        ...(toast.action
          ? { action: { label: toast.action.label, run: toast.action.onClick } }
          : {}),
        id: toast.id,
      }),
  });
  return delivered ? toast.id : void 0;
}

export const toaster = {
  create(toast: UiToast): string | undefined {
    if (toast.type === "error") return createErrorToast(toast);
    const notice = {
      title: title(toast),
      description:
        toast.title && typeof toast.description === "string" ? toast.description : void 0,
      id: toast.id,
    };
    const delivered = deliver({
      title: notice.title,
      send: (host) => {
        if (toast.type === "warning") host.warned(notice);
        else if (toast.type === "info") host.informed(notice);
        else host.succeeded(notice);
      },
    });
    return delivered ? toast.id : void 0;
  },

  /**
   * The two lifecycle calls a call site makes on a toast it raised. The application's toaster
   * owns dismissal and the feedback port has no handle to hand back, so these are no-ops rather
   * than a pretence.
   */
  dismiss(_id?: string): void {},
  remove(_id?: string): void {},

  success(toast: UiToast): string | undefined {
    return toaster.create({ ...toast, type: "success" });
  },
  error(toast: UiToast): string | undefined {
    return toaster.create({ ...toast, type: "error" });
  },
  info(toast: UiToast): string | undefined {
    return toaster.create({ ...toast, type: "info" });
  },
  warning(toast: UiToast): string | undefined {
    return toaster.create({ ...toast, type: "warning" });
  },
  loading(toast: UiToast): string | undefined {
    return toaster.create({ ...toast, type: "loading" });
  },
};
