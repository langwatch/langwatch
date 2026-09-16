/**
 * How this family tells the reader how an action turned out. The toaster
 * and `showErrorToast` are application singletons, re-bound to the host
 * port; the raw error travels, since the app resolves copy from its `code`.
 */

import { useCallback, useMemo } from "react";

import { useModelProviderHost } from "../model/model-provider-host.ts";

/** The subset of the application toaster's create options this family uses. */
export type ModelProviderToast = {
  title: string;
  description?: string;
  type?: string;
  duration?: number;
  id?: string;
};

export type ModelProviderToaster = { create: (toast: ModelProviderToast) => void };

/** A warning is a failure, not a quieter success: both leave through `failed`. */
function emitToast({
  host,
  toast,
}: {
  host: ReturnType<typeof useModelProviderHost>;
  toast: ModelProviderToast;
}): void {
  const isFailure = toast.type === "error" || toast.type === "warning";
  if (isFailure) {
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
}

export function useModelProviderToaster(): ModelProviderToaster {
  const host = useModelProviderHost();

  return useMemo(
    () => ({ create: (toast: ModelProviderToast) => emitToast({ host, toast }) }),
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
 * Reports a failure, unless the application already put it on screen.
 * `isReportedGlobally` is asked first, same as the model-costs table: a
 * refusal already rendered as a modal must not also arrive as a toast.
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
