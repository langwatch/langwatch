/**
 * How an activity table tells the reader how something turned out.
 *
 * `platform/app`'s `~/components/ui/toaster` and `~/features/errors`'s
 * `showErrorToast` are application singletons a feature-web package may not
 * reach, so the two names the tables already call are re-bound to the host
 * port. The call SHAPES are carried over unchanged on purpose —
 * `toaster.create({ title, type })` and `showErrorToast({ error, fallbackTitle })`
 * — so the move touches the two lines that acquire them and none of the call
 * sites that use them.
 */

import { useCallback, useMemo } from "react";
import { useCodingAgentActivityHost } from "./coding-agent-activity-host";

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
