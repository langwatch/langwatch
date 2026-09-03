/**
 * How a front-door screen tells the reader an attempt was refused.
 *
 * `@langwatch/design-system/toaster` is the application's toast singleton, and
 * a feature-web package reaching it for a FAILURE is the bypass this module
 * closes: the toaster renders whatever string it is handed, so the sign-in and
 * sign-up screens were writing their own error copy where the composition's
 * code-keyed registry, its remediation tips, its docs link and its trace id
 * were already waiting behind `AuthHostPort.failed` (ADR-045).
 *
 * The shape is the one `@langwatch/automation-web`, `@langwatch/gateway-web`,
 * `@langwatch/ops-web` and `@langwatch/coding-agent-web` already state, so a
 * reader who has seen one re-binder has seen this one.
 *
 * THE HOST IS OPTIONAL HERE, and only here. Every other family's screens run
 * behind a session and are always mounted inside their frontend feature; the
 * front door's two screens are also rendered by suites that compose nothing
 * above them, and a hook that threw would turn "this suite did not mount a
 * host" into "sign-in is broken". With no host the refusal still reaches the
 * reader — both screens put the same sentence in the card's inline alert — so
 * dropping the second channel is the honest degradation, and the warning says
 * which composition forgot.
 */

import { useCallback } from "react";
import { useOptionalAuthHost } from "../model/auth-host";

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
        // oxlint-disable-next-line no-console
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
