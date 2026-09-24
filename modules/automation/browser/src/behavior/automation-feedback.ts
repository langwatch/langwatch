/**
 * Re-bind application error/toaster functions via host port with unchanged
 * call shapes; feature packages cannot reach app singletons directly.
 */

import { useCallback, useMemo } from "react";

import { type AutomationHost, useAutomationHost } from "../model/automation-host.ts";

/** The subset of the application toaster's create options this family uses. */
export type AutomationToast = {
  title: string;
  description?: string;
  type?: string;
  id?: string;
};

export type AutomationToaster = { create: (toast: AutomationToast) => void };

export function useAutomationToaster(): AutomationToaster {
  const host = useAutomationHost();
  return useMemo(
    () => ({
      create: (toast: AutomationToast) => createToast({ host, toast }),
    }),
    [host],
  );
}

function createToast({ host, toast }: { host: AutomationHost; toast: AutomationToast }): void {
  if (toast.type === "error") {
    host.failed({
      error: void 0,
      fallbackTitle: toast.title,
      ...(toast.description ? { title: toast.title } : {}),
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

export type AutomationErrorToastOptions = {
  error: unknown;
  /** Names the action that failed, for a code the host cannot say more about. */
  fallbackTitle?: string;
  /** A hard override of the title, kept because the platform helper had one. */
  title?: string;
  id?: string;
};

export function useShowErrorToast(): (options: AutomationErrorToastOptions) => void {
  const host = useAutomationHost();
  return useCallback(
    ({ error, fallbackTitle, title, id }: AutomationErrorToastOptions) =>
      host.failed({
        error,
        fallbackTitle: fallbackTitle ?? "Something went wrong",
        ...(title ? { title } : {}),
        ...(id ? { id } : {}),
      }),
    [host],
  );
}

/** One line of copy for a failure, where a toast would not fit. */
export function useDescribeError(): (options: AutomationErrorToastOptions) => string {
  const host = useAutomationHost();
  return useCallback(
    ({ error, fallbackTitle, title }: AutomationErrorToastOptions) =>
      host.describeFailure({
        error,
        fallbackTitle: fallbackTitle ?? "Something went wrong",
        ...(title ? { title } : {}),
      }),
    [host],
  );
}
