/**
 * How an automations surface tells the reader how an action turned out.
 *
 * `~/components/ui/toaster` and `~/features/errors`'s `showErrorToast` /
 * `describeError` are application singletons a feature-web package may not
 * reach, so the names the screen already calls are re-bound to the host port.
 * The call SHAPES are carried over unchanged on purpose —
 * `toaster.create({ title, type })`, `showErrorToast({ error, fallbackTitle })`
 * and `describeError({ error, fallbackTitle })` — so the move touches the lines
 * that acquire them and none of the call sites that use them.
 *
 * WHAT DOES NOT COME WITH THEM, and is a later slice: the code-keyed
 * presentation registry. `apps/ui` resolves a handful of codes and falls back
 * to the action name plus the generic line; the full registry, its tips, its
 * docs links and its global-handler dedup still live in `platform/app`.
 *
 * `explainAnyError` does not travel at all. The authoring drawer used it to
 * decide whether a code carried registered copy, so a test-fire attempt could
 * be logged with the same words the toast said. A screen cannot ask the host
 * that question without the registry, so the attempt log takes the same
 * one-line description the toast would show, which is the property the log was
 * after — recorded in `dev/docs/plans/ui-family-move-manifests.md`.
 */

import { useCallback, useMemo } from "react";
import { useAutomationHost } from "../model/automation-host";

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
      create: (toast: AutomationToast) => {
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
      },
    }),
    [host],
  );
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
