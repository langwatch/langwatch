// Feedback port for activity tables; re-binds app toaster/error singletons
// with unchanged call shapes for seamless porting.

import { useCallback, useMemo } from "react";
import { useCodingAgentActivityHost } from "./coding-agent-activity-host.ts";

/** The subset of the application toaster's create options these tables use. */
export type CodingAgentToast = {
  title: string;
  description?: string;
  type?: string;
  id?: string;
};

export type CodingAgentToaster = { create: (toast: CodingAgentToast) => void };

export function useCodingAgentToaster(): CodingAgentToaster {
  const host = useCodingAgentActivityHost();
  return useMemo(
    () => ({
      create: (toast: CodingAgentToast) => {
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

export type CodingAgentErrorToastOptions = {
  error: unknown;
  /** Names the action that failed, for a code the host cannot say more about. */
  fallbackTitle?: string;
  title?: string;
  id?: string;
};

export function useShowErrorToast(): (options: CodingAgentErrorToastOptions) => void {
  const host = useCodingAgentActivityHost();
  return useCallback(
    ({ error, fallbackTitle, title, id }: CodingAgentErrorToastOptions) =>
      host.failed({
        error,
        fallbackTitle: title ?? fallbackTitle ?? "Something went wrong",
        ...(id ? { id } : {}),
      }),
    [host],
  );
}
