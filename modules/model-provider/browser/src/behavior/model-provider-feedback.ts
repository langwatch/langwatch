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

/** Routes one toast to the host by its type: error, warning, info, else success. */
function emitToast({
  host,
  toast,
}: {
  host: ReturnType<typeof useModelProviderHost>;
  toast: ModelProviderToast;
}): void {
  if (toast.type === "error") {
    host.failed({
      error: void 0,
      fallbackTitle: toast.description ? `${toast.title}. ${toast.description}` : toast.title,
      ...(toast.id ? { id: toast.id } : {}),
    });
    return;
  }

  const notice = {
    title: toast.title,
    ...(toast.description ? { description: toast.description } : {}),
    ...(toast.id ? { id: toast.id } : {}),
  };
  if (toast.type === "warning") host.warned(notice);
  else if (toast.type === "info") host.informed(notice);
  else host.succeeded(notice);
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
