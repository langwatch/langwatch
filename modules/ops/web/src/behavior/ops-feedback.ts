/** Re-bind app singletons through host port; call shapes preserved, presentation
 * registry deferred. */

import { useCallback, useMemo } from "react";
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

export function useOpsToaster(): OpsToaster {
  const host = useOpsHost();
  return useMemo(
    () => ({
      create: (toast: OpsToast) => {
        if (toast.type === "error") {
          host.failed({
            error: void 0,
            fallbackTitle: toast.title,
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
