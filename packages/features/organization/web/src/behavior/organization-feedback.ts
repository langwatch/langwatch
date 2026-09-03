/**
 * How an organization surface tells the reader how an action turned out.
 *
 * `~/components/ui/toaster` and `~/features/errors`'s `showErrorToast` are
 * application singletons a feature-web package may not reach, so the names the
 * screens already call are re-bound to the host port. The call SHAPES are
 * carried over unchanged on purpose — `toaster.create({ title, type })` and
 * `showErrorToast({ error, fallbackTitle })` — so the move touches the lines
 * that acquire them and none of the call sites that use them. The same shape
 * `@langwatch/automation-web` states, for the same reasons.
 *
 * WHAT DOES NOT COME WITH THEM, and is a later slice: the code-keyed
 * presentation registry. The composing application resolves a handful of codes
 * and falls back to the action name plus the generic line; the full registry
 * still lives in `platform/app`.
 */

import { useCallback, useMemo } from "react";
import { useOrganizationHost } from "../model/organization-host";

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
