/**
 * What Settings, Checkup and the startup notice ask of the shell. The screen
 * reads no session or router itself; the module mounts this port from
 * `@langwatch/browser-host` capabilities. ARCHITECTURE.md §3.4.
 */

import { createContext, useContext } from "react";

/** A failure, as the screen knows it: the raw error, and the action that failed. */
export type CheckupFailureNotice = {
  error: unknown;
  fallbackTitle: string;
};

export abstract class CheckupHostApi {
  /** The organization the page is opened in. */
  abstract organizationId(): string | undefined;

  /** Whether this deployment is LangWatch Cloud. Fail-safe: false. */
  abstract isSaaS(): boolean;

  /** Whether the reader may manage the organization. Fail-closed. */
  abstract canManageOrganization(): boolean;

  abstract failed(failure: CheckupFailureNotice): void;

  /** One failure as a sentence, its words resolved from its code. */
  abstract describeFailure(failure: CheckupFailureNotice): string;
}

const CheckupHostContext = createContext<CheckupHostApi | undefined>(void 0);

export const CheckupHostProvider = CheckupHostContext.Provider;

/** The host this screen is mounted in; missing is a composition fault. */
export function useCheckupHost(): CheckupHostApi {
  const host = useContext(CheckupHostContext);
  if (!host) {
    throw new Error(
      "No checkup host is mounted above this screen; render it inside the ops frontend feature.",
    );
  }
  return host;
}
