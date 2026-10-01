/**
 * Front-door error feedback through code-keyed registry (ADR-045). Closes
 * bypass where screens wrote own copy. Host optional (unlike other families).
 */

import { useCallback } from "react";

import { useOptionalAuthHost } from "../model/auth-host.ts";

export type AuthErrorToastOptions = {
  /** The failure itself. The composition resolves the words from its code. */
  error: unknown;
  /** Names the action that failed, for a code the registry does not list. */
  fallbackTitle?: string;
  /** The sentence the screen already composed, where there is no code at all. */
  description?: string;
  id?: string;
};

export function useShowErrorToast(): (options: AuthErrorToastOptions) => void {
  const host = useOptionalAuthHost();
  return useCallback(
    ({ error, fallbackTitle, description, id }: AuthErrorToastOptions) => {
      if (!host) {
        console.warn(
          "A front-door failure was reported with no host mounted:",
          fallbackTitle ?? description,
        );
        return;
      }
      host.failed({
        error,
        fallbackTitle: fallbackTitle ?? "Something went wrong",
        ...(description ? { description } : {}),
        ...(id ? { id } : {}),
      });
    },
    [host],
  );
}
