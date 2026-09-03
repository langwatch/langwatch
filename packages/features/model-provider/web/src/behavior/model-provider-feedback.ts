/**
 * How this family tells the reader how an action turned out.
 *
 * `~/components/ui/toaster` and `~/features/errors`'s `showErrorToast` are
 * application singletons a feature-web package may not reach, so the two names
 * the recovered editor modules already call are re-bound to the host port. The
 * call SHAPES are carried over unchanged on purpose — `toaster.create({ title,
 * type })` and `showErrorToast({ error, fallbackTitle })` — so the move touches
 * the lines that acquire them and none of the lines that use them. The same
 * shape `@langwatch/organization-web` and `@langwatch/automation-web` state, for
 * the same reasons.
 *
 * WHAT DOES NOT COME WITH THEM: the code-keyed presentation registry. The
 * composing application resolves the words a customer reads from the error's
 * own `code`, which is why every call here hands over the RAW error and a
 * `fallbackTitle` naming the action, rather than a sentence this package
 * composed.
 *
 * A WARNING IS A FAILURE, not a quieter success. The provider form raises one
 * when some of a batch of default-model writes were refused — "Some default
 * model assignments failed" — and routing that through `succeeded` would print
 * a failure under a tick.
 */

import { useCallback, useMemo } from "react";

import { useModelProviderHost } from "../model/model-provider-host";

/** The subset of the application toaster's create options this family uses. */
export type ModelProviderToast = {
  title: string;
  description?: string;
  type?: string;
  duration?: number;
  id?: string;
};

export type ModelProviderToaster = { create: (toast: ModelProviderToast) => void };

export function useModelProviderToaster(): ModelProviderToaster {
  const host = useModelProviderHost();
  return useMemo(
    () => ({
      create: (toast: ModelProviderToast) => {
        if (toast.type === "error" || toast.type === "warning") {
          host.failed({
            error: void 0,
            fallbackTitle: toast.description ? `${toast.title}. ${toast.description}` : toast.title,
            ...(toast.id ? { id: toast.id } : {}),
          });
          return;
        }
        host.succeeded({
          title: toast.title,
          ...(toast.description ? { description: toast.description } : {}),
          ...(toast.id ? { id: toast.id } : {}),
        });
      },
    }),
    [host],
  );
}

export type ModelProviderErrorToastOptions = {
  error: unknown;
  /** Names the action that failed, for a code the host cannot say more about. */
  fallbackTitle?: string;
  id?: string;
};

/**
 * Reports a failure, unless the application has already put it on screen.
 *
 * `isReportedGlobally` is asked first for the same reason the model-costs table
 * asks it: a refusal the application already rendered as a modal must not also
 * arrive as a toast.
 */
export function useShowErrorToast(): (options: ModelProviderErrorToastOptions) => void {
  const host = useModelProviderHost();
  return useCallback(
    ({ error, fallbackTitle, id }: ModelProviderErrorToastOptions) => {
      if (host.isReportedGlobally(error)) return;
      host.failed({
        error,
        fallbackTitle: fallbackTitle ?? "Something went wrong",
        ...(id ? { id } : {}),
      });
    },
    [host],
  );
}
