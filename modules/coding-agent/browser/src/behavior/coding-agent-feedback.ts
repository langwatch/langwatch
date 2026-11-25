// Feedback port for activity tables; re-binds app toaster/error singletons
// with unchanged call shapes for seamless porting.

import { useCallback } from "react";

import { useCodingAgentActivityHost } from "./coding-agent-activity-host.ts";

/** The subset of the application toaster's create options these tables use. */
export type CodingAgentToast = {
  title: string;
  description?: string;
  type?: string;
  id?: string;
};

export type CodingAgentToaster = { create: (toast: CodingAgentToast) => void };

/** Routes one toast to the host by its type: error, warning, info, else success. */
function raise({
  host,
  toast,
}: {
  host: ReturnType<typeof useCodingAgentActivityHost>;
  toast: CodingAgentToast;
}): void {
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

export function useCodingAgentToaster(): CodingAgentToaster {
  const host = useCodingAgentActivityHost();
  return { create: (toast: CodingAgentToast) => raise({ host, toast }) };
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
