/** Feedback methods re-bound to host port, preserving call shapes for migration. */

import { useCallback, useMemo } from "react";
import { useOrganizationHost } from "../model/organization-host.ts";

/** The subset of the application toaster's create options this family uses. */
export type OrganizationToast = {
  title: string;
  description?: string;
  type?: string;
  duration?: number;
  id?: string;
};

export type OrganizationToaster = { create: (toast: OrganizationToast) => void };

export function useOrganizationToaster(): OrganizationToaster {
  const host = useOrganizationHost();
  return useMemo(
    () => ({
      create: (toast: OrganizationToast) => {
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

export type OrganizationErrorToastOptions = {
  error: unknown;
  /** Names the action that failed, for a code the host cannot say more about. */
  fallbackTitle?: string;
  id?: string;
};

export function useShowErrorToast(): (options: OrganizationErrorToastOptions) => void {
  const host = useOrganizationHost();
  return useCallback(
    ({ error, fallbackTitle, id }: OrganizationErrorToastOptions) =>
      host.failed({
        error,
        fallbackTitle: fallbackTitle ?? "Something went wrong",
        ...(id ? { id } : {}),
      }),
    [host],
  );
}
