/**
 * What the SCIM screen asks of the application it is mounted in.
 *
 * Two questions and two notices: which organization the tokens belong to, and
 * what base URL an identity provider posts to. The second is on the port rather
 * than read from `window` because it is a DEPLOYMENT fact — the address the
 * customer's IdP will be configured with — and a screen that composes it from
 * `window.location.origin` is right only as long as nothing sits in front of
 * the application.
 */

import { createContext, useContext } from "react";

export type ScimSuccessNotice = {
  title: string;
  description?: string;
};

/**
 * A failure, as the screen knows it.
 *
 * The raw `error` travels, never a sentence the screen composed: the words a
 * customer reads are resolved from the error's `code` by the host's
 * presentation registry (#5984).
 */
export type ScimFailureNotice = {
  error: unknown;
  fallbackTitle: string;
};

export abstract class ScimHostPort {
  /** The organization the tokens are minted against. */
  abstract organizationId(): string | undefined;

  /** The address an identity provider posts SCIM requests to. */
  abstract scimBaseUrl(): string;

  abstract succeeded(notice: ScimSuccessNotice): void;

  abstract failed(failure: ScimFailureNotice): void;
}

const ScimHostContext = createContext<ScimHostPort | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const ScimHostProvider = ScimHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useScimHost(): ScimHostPort {
  const host = useContext(ScimHostContext);
  if (!host) {
    throw new Error(
      "No SCIM host is mounted above this screen; render it inside the SCIM frontend feature.",
    );
  }
  return host;
}
