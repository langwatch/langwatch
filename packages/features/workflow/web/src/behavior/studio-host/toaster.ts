/**
 * The toast singleton the moved studio modules already call.
 *
 * Twenty-five files in the studio's closure write
 * `toaster.create({ title, description, type: "error" })`, and a feature-web
 * package may not import a toast renderer. This is the same call answered by
 * the family's feedback capability: an `error` toast becomes
 * `WorkflowHostPort.failed`, everything else becomes `succeeded`, and the
 * application's own toaster renders it with the application's own copy rules.
 *
 * NOTHING IS RENDERED HERE and no copy is written here. It routes; it does not
 * toast. That is the whole difference between this module and the package-local
 * toaster the trace family carried, and it is what the corpus guard checks: a
 * `toaster`-shaped export inside a feature-web package is a finding unless
 * every failure it can raise leaves through a host port.
 *
 * THE FAILURE TRAVELS WHOLE. `error` is on {@link StudioToast} because the
 * words a customer reads are resolved from the error's `code` by the
 * application's registry, and a call site that hands over only a title has
 * thrown that away before the port ever sees it. The studio's coded failures —
 * a node's `domainError`, a `target_result`'s — are serialised handled errors,
 * and the application reads that shape directly.
 *
 * IT IS A SINGLETON BECAUSE THE CALL SITES ARE NOT COMPONENTS. Half of them
 * fire from a mutation callback or a store action, where no hook can run. The
 * host that is currently mounted registers itself here; a toast raised with no
 * host mounted is dropped with a console warning rather than throwing, because
 * a failed toast must never be the thing that takes a page down.
 */

import type { ReactNode } from "react";

import type { WorkflowHostPort } from "../../model/workflow-host";

export type StudioToast = {
  /** A node, because a handful of call sites raise a title with a chip in it. */
  title?: ReactNode;
  /** Likewise: a few toasts carry an action button in their body. */
  description?: ReactNode;
  /**
   * The failure itself, for an `error` toast that has one.
   *
   * Handed to the host untouched, because the application's code-keyed registry
   * is what turns it into words. A call site with nothing to give — the studio
   * socket is not connected yet, a run timed out on the browser's own clock —
   * leaves it unset, and the notice degrades to its `title` plus ADR-045's
   * unknown state, which is the honest answer for a failure that never crossed
   * a wire.
   */
  error?: unknown;
  type?: "error" | "success" | "warning" | "info" | "loading";
  duration?: number;
  id?: string;
  meta?: unknown;
  placement?: string;
  action?: { label: string; onClick: () => void };
};

let mounted: WorkflowHostPort | undefined;

/** Called by the studio's host provider on mount, and cleared on unmount. */
export function setStudioFeedbackHost(host: WorkflowHostPort | undefined): void {
  mounted = host;
}

/**
 * The toast's headline as a string.
 *
 * The feedback capability takes text, and a few call sites raise a node. What
 * a node degrades to is its text content where React gives us one, and the
 * description otherwise — never `[object Object]` in front of a customer.
 */
function title(toast: StudioToast): string {
  if (typeof toast.title === "string") return toast.title;
  if (typeof toast.title === "number") return String(toast.title);
  return typeof toast.description === "string" ? toast.description : "";
}

export const toaster = {
  create(toast: StudioToast): string | undefined {
    if (!mounted) {
      // eslint-disable-next-line no-console
      console.warn("A studio toast was raised with no host mounted:", title(toast));
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
   * The two lifecycle calls the closure makes on a toast it raised.
   *
   * The application's toaster owns dismissal, and the family's feedback
   * capability has no handle to hand back, so these are no-ops rather than a
   * pretence. What is lost is a spinner toast being replaced in place by its
   * result; what the reader sees instead is two toasts.
   */
  dismiss(_id?: string): void {},
  remove(_id?: string): void {},

  /**
   * The four shorthands Chakra's toaster publishes, kept because the moved code
   * uses them interchangeably with `create`.
   */
  success(toast: StudioToast): string | undefined {
    return toaster.create({ ...toast, type: "success" });
  },
  error(toast: StudioToast): string | undefined {
    return toaster.create({ ...toast, type: "error" });
  },
  info(toast: StudioToast): string | undefined {
    return toaster.create({ ...toast, type: "info" });
  },
  warning(toast: StudioToast): string | undefined {
    return toaster.create({ ...toast, type: "warning" });
  },
  loading(toast: StudioToast): string | undefined {
    return toaster.create({ ...toast, type: "loading" });
  },
};
