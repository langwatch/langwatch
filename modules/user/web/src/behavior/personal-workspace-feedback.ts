/** Feedback surface for personal-workspace screens, bound through host port. */

import { useCallback, useMemo } from "react";
import { usePersonalWorkspaceHost } from "../model/personal-workspace-host.ts";

/** The subset of the application toaster's create options these screens use. */
export type PersonalToast = {
  title: string;
  description?: string;
  type?: string;
  id?: string;
};

export type PersonalToaster = { create: (toast: PersonalToast) => void };

export function usePersonalToaster(): PersonalToaster {
  const host = usePersonalWorkspaceHost();
  return useMemo(
    () => ({
      create: (toast: PersonalToast) => {
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

export type PersonalErrorToastOptions = {
  error: unknown;
  /** Names the action that failed, for a code the host cannot say more about. */
  fallbackTitle?: string;
  /** A hard override of the title, kept because the platform helper had one. */
  title?: string;
  id?: string;
};

export function useShowErrorToast(): (options: PersonalErrorToastOptions) => void {
  const host = usePersonalWorkspaceHost();
  return useCallback(
    ({ error, fallbackTitle, title, id }: PersonalErrorToastOptions) =>
      host.failed({
        error,
        fallbackTitle: title ?? fallbackTitle ?? "Something went wrong",
        ...(id ? { id } : {}),
      }),
    [host],
  );
}
