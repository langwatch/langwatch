// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What single sign-on's screens ask of the host application: which
 * organization is in scope, and where a failure's words come from. Never the
 * router, never browser-host directly (ARCHITECTURE.md §10.1).
 */
import { createContext, useContext } from "react";

/** Raw errors, so the host resolves the words through its registry (#5984). */
export type SsoFailureNotice = {
  error: unknown;
  fallbackTitle: string;
};

export abstract class SsoHostApi {
  /** The organization whose connection is being read. */
  abstract organizationId(): string | undefined;

  abstract failed(failure: SsoFailureNotice): void;
}

const SsoHostContext = createContext<SsoHostApi | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const SsoHostProvider = SsoHostContext.Provider;

export function useSsoHost(): SsoHostApi {
  const host = useContext(SsoHostContext);
  if (!host) {
    throw new Error(
      "No SSO host is mounted above this screen; render it inside the SSO frontend feature.",
    );
  }

  return host;
}

/** The grant the organization's authentication page asked for, unchanged. */
export const SSO_PAGE_PERMISSION = "organization:manage";
