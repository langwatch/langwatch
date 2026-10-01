/**
 * Gateway screen feedback: re-bound toaster and error-toast names.
 * Presentation registry stays in apps/ui.
 */

import { useCallback, useMemo } from "react";

import { useGatewayHost } from "../model/gateway-host.ts";

/** The subset of the application toaster's create options these screens use. */
export type GatewayToast = {
  title: string;
  description?: string;
  type?: string;
  id?: string;
};

export type GatewayToaster = { create: (toast: GatewayToast) => void };

export function useGatewayToaster(): GatewayToaster {
  const host = useGatewayHost();
  return useMemo(
    () => ({
      create: (toast: GatewayToast) => {
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

export type GatewayErrorToastOptions = {
  error: unknown;
  /** Names the action that failed, for a code the host cannot say more about. */
  fallbackTitle?: string;
  /** A hard override of the title, kept because the platform helper had one. */
  title?: string;
  id?: string;
};

export function useShowErrorToast(): (options: GatewayErrorToastOptions) => void {
  const host = useGatewayHost();
  return useCallback(
    ({ error, fallbackTitle, title, id }: GatewayErrorToastOptions) =>
      host.failed({
        error,
        fallbackTitle: title ?? fallbackTitle ?? "Something went wrong",
        ...(id ? { id } : {}),
      }),
    [host],
  );
}
