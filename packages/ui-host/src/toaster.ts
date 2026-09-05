/**
 * The toast singleton every browser feature calls, routed to one port.
 *
 * A feature package may not import a toast renderer, and it should not carry a
 * second one: `toaster.create({ title, type: "error" })` becomes
 * `UiFeedbackPort.failed`, everything else becomes `succeeded`, and the
 * application's own toaster — the one component that draws a toast — renders it
 * with the application's own copy rules. NOTHING IS RENDERED HERE.
 *
 * THE FAILURE TRAVELS WHOLE. `error` rides on the toast because the words a
 * customer reads are resolved from the error's `code` by the presentation
 * registry, and a call site that hands over only a title has thrown that away
 * before the port ever sees it.
 *
 * IT IS A SINGLETON BECAUSE THE CALL SITES ARE NOT COMPONENTS. Half of them
 * fire from a mutation callback or a store action, where no hook can run. The
 * host that is currently mounted registers itself here; a toast raised with no
 * host mounted is dropped with a warning rather than thrown, because a failed
 * toast must never be the thing that takes a page down.
 */

import type { UiFailureNotice, UiSuccessNotice } from "./capabilities";

/**
 * Whatever answers a report — the application's feedback capability, or a
 * feature host that already answers the same two questions.
 */
export type UiFeedbackSink = {
  succeeded(notice: UiSuccessNotice): void;
  failed(failure: UiFailureNotice): void;
};

export type UiToast = {
  /** A node, because a handful of call sites raise a title with a chip in it. */
  title?: unknown;
  /** Likewise: a few toasts carry an action button in their body. */
  description?: unknown;
  /**
   * The failure itself, for an `error` toast that has one.
   *
   * Handed to the host untouched, because the code-keyed registry is what turns
   * it into words. A call site with nothing to give leaves it unset and the
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

let mounted: UiFeedbackSink | undefined;

/** Called by whatever mounts a feedback host, and cleared on unmount. */
export function setUiFeedbackHost(host: UiFeedbackSink | undefined): void {
  mounted = host;
}

/** The host a report goes to, for the error module next door. */
export function currentUiFeedbackHost(): UiFeedbackSink | undefined {
  return mounted;
}

/**
 * The toast's headline as a string.
 *
 * The feedback port takes text and a few call sites raise a node. A node
 * degrades to the description where there is one — never `[object Object]` in
 * front of a customer.
 */
function title(toast: UiToast): string {
  if (typeof toast.title === "string") return toast.title;
  if (typeof toast.title === "number") return String(toast.title);
  return typeof toast.description === "string" ? toast.description : "";
}

export const toaster = {
  create(toast: UiToast): string | undefined {
    if (!mounted) {
      // oxlint-disable-next-line no-console
      console.warn("A toast was raised with no feedback host mounted:", title(toast));
      return void 0;
    }
    if (toast.type === "error") {
      mounted.failed({
        error: toast.error,
        fallbackTitle: title(toast),
        description: typeof toast.description === "string" ? toast.description : void 0,
        ...(toast.action
          ? { action: { label: toast.action.label, run: toast.action.onClick } }
          : {}),
        id: toast.id,
      });
      return toast.id;
    }
    mounted.succeeded({
      title: title(toast),
      description:
        toast.title && typeof toast.description === "string" ? toast.description : void 0,
      id: toast.id,
    });
    return toast.id;
  },

  /**
   * The two lifecycle calls a call site makes on a toast it raised.
   *
   * The application's toaster owns dismissal and the feedback port has no
   * handle to hand back, so these are no-ops rather than a pretence. What is
   * lost is a spinner toast being replaced in place by its result; what the
   * reader sees instead is two toasts.
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
