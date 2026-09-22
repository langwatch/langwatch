// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What single sign-on's screens ask of the host application: which
 * organization is in scope, and where a failure's words come from. Never the
 * router, never browser-host directly (ARCHITECTURE.md §10.1).
 */
import { createContext, useContext } from "react";

import type { SsoQueryReading } from "./test-sign-in-callback.ts";

/** Raw errors, so the host resolves the words through its registry (#5984). */
export type SsoFailureNotice = {
  error: unknown;
  fallbackTitle: string;
};

/** The address a section is rendering at, in the one half it reads. */
export type SsoRouteReading = {
  /** Single-valued, as `UiRoute` hands it over. */
  readonly query: SsoQueryReading;
};

/**
 * What the sign-in turned the request away with, before the browser ever
 * left. Not a handled payload of ours: it comes from the identity provider,
 * or from the engine talking to it.
 */
export type SsoTestSignInRefusal = {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly statusText?: string | undefined;
  readonly status?: number | undefined;
};

export type SsoTestSignInResult = { readonly error?: SsoTestSignInRefusal | null };

export abstract class SsoHostApi {
  /** The organization whose connection is being read. */
  abstract organizationId(): string | undefined;

  abstract failed(failure: SsoFailureNotice): void;

  /**
   * Whether this reader may change what they are looking at. Seeing the page is
   * `sso:view` and every control on it is `sso:manage` (ADR-122), so the page
   * renders for a reader who holds neither lever.
   */
  abstract canManage(): boolean;

  /** The reader's own address: every sentence about a refused test names it. */
  abstract currentUserAddress(): string | undefined;

  abstract route(): SsoRouteReading;

  /**
   * Sending this browser to the identity provider and back, naming the
   * connection rather than going through the sign-in screens — which is what
   * makes the test possible before anybody's sign-in has been switched over.
   * The host answers it from auth's published capability; `callbackQuery` is
   * the query this page must come back carrying, because the marker that says
   * an error belongs to this test is single sign-on's own (handoff §10).
   */
  abstract testSignIn(options: {
    connectionId: string;
    callbackQuery: Readonly<Record<string, string | undefined>>;
  }): Promise<SsoTestSignInResult>;

  /**
   * The sign-in's own spelling of a code, for the codes the engine emits
   * under more than one name. Answered by auth, which owns the list.
   */
  abstract normalizeSignInErrorCode(code: string): string;
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

/** Seeing the page is `sso:view`; its controls take `sso:manage` (ADR-122). */
export const SSO_PAGE_PERMISSION = "sso:view";
