// Governance screen feedback: re-binds application toaster and error handler
// to host port; presentation registry (code keys, tips, docs) deferred.

import { useCallback, useMemo } from "react";

import { type GovernanceHostApi, useGovernanceHost } from "../model/governance-host.ts";

/** The subset of the application toaster's create options these screens use. */
export type GovernanceToast = {
  title: string;
  description?: string;
  type?: string;
  id?: string;
};

export type GovernanceToaster = { create: (toast: GovernanceToast) => void };

/** Routes one toast to the host by its type: error, warning, info, else success. */
function raise({ host, toast }: { host: GovernanceHostApi; toast: GovernanceToast }): void {
  const { title, description, id } = toast;
  if (toast.type === "error") {
    host.failed({ error: void 0, fallbackTitle: title, description, id });
    return;
  }
  const notice = { title, description, id };
  if (toast.type === "warning") host.warned(notice);
  else if (toast.type === "info") host.informed(notice);
  else host.succeeded(notice);
}

export function useGovernanceToaster(): GovernanceToaster {
  const host = useGovernanceHost();
  return useMemo(() => ({ create: (toast: GovernanceToast) => raise({ host, toast }) }), [host]);
}

export type GovernanceErrorToastOptions = {
  error: unknown;
  /** Names the action that failed, for a code the host cannot say more about. */
  fallbackTitle?: string;
  /** A hard override of the title, kept because the platform helper had one. */
  title?: string;
  id?: string;
};

export function useShowErrorToast(): (options: GovernanceErrorToastOptions) => void {
  const host = useGovernanceHost();
  return useCallback(
    ({ error, fallbackTitle, title, id }: GovernanceErrorToastOptions) =>
      host.failed({
        error,
        fallbackTitle: title ?? fallbackTitle ?? "Something went wrong",
        ...(id ? { id } : {}),
      }),
    [host],
  );
}
