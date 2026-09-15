// What the SCIM screen asks of its host application: organization tokens and the
// base URL for IdP posts, which must come from the deployment, not window.location.

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

export abstract class ScimHostApi {
  /** The organization the tokens are minted against. */
  abstract organizationId(): string | undefined;

  /** The address an identity provider posts SCIM requests to. */
  abstract scimBaseUrl(): string;

  abstract succeeded(notice: ScimSuccessNotice): void;

  abstract failed(failure: ScimFailureNotice): void;
}

const ScimHostContext = createContext<ScimHostApi | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const ScimHostProvider = ScimHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useScimHost(): ScimHostApi {
  const host = useContext(ScimHostContext);
  if (!host) {
    throw new Error(
      "No SCIM host is mounted above this screen; render it inside the SCIM frontend feature.",
    );
  }
  return host;
}
