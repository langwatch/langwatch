/**
 * How a gateway screen tells the reader how an action turned out.
 *
 * `~/components/ui/toaster` and `~/features/errors`'s `showErrorToast` are both
 * application singletons a feature-web package may not reach, so the two names
 * the screens already call are re-bound to the host port. The call SHAPES are
 * carried over unchanged on purpose — `toaster.create({ title, type })` and
 * `showErrorToast({ error, fallbackTitle })` — so the move touches the two lines
 * that acquire them and none of the call sites that use them.
 *
 * WHAT DOES NOT COME WITH THEM, and is a later slice: the code-keyed
 * presentation registry. `apps/ui` resolves a handful of codes and falls back to
 * the action name plus the generic line; the full registry, its tips, its docs
 * links and its global-handler dedup still live in `platform/app`.
 */

import { useCallback, useMemo } from "react";
import { useGatewayHost } from "../model/gateway-host";

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
