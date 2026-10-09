/** Re-bind app singletons through host port; call shapes preserved, presentation
 * registry deferred. */

import { useCallback } from "react";

import { useOpsHost } from "../model/ops-host.ts";

/** The subset of the application toaster's create options these surfaces use. */
export type OpsToast = {
  title: string;
  description?: string;
  type?: string;
  id?: string;
  duration?: number;
};

export type OpsToaster = { create: (toast: OpsToast) => void };

/** Routes one toast to the host by its type: error, warning, info, else success. */
function raise({ host, toast }: { host: ReturnType<typeof useOpsHost>; toast: OpsToast }): void {
  if (toast.type === "error") {
    host.failed({
      error: void 0,
      fallbackTitle: toast.title,
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

export function useOpsToaster(): OpsToaster {
  const host = useOpsHost();
  return { create: (toast: OpsToast) => raise({ host, toast }) };
}

export type OpsErrorToastOptions = {
  error: unknown;
  /** Names the action that failed, for a code the host cannot say more about. */
  fallbackTitle?: string;
  /** A hard override of the title, kept because the platform helper had one. */
  title?: string;
  id?: string;
};

export function useShowErrorToast(): (options: OpsErrorToastOptions) => void {
  const host = useOpsHost();
  return useCallback(
    ({ error, fallbackTitle, title, id }: OpsErrorToastOptions) =>
      host.failed({
        error,
        fallbackTitle: title ?? fallbackTitle ?? "Something went wrong",
        ...(id ? { id } : {}),
      }),
    [host],
  );
}
