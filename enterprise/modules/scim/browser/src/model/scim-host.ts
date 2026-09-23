// What the SCIM screen asks of its host application: organization tokens and the
// base URL for IdP posts, which must come from the deployment, not window.location.

import { createContext, useContext } from "react";

export type ScimSuccessNotice = {
  title: string;
  description?: string;
};

/**
 * Raw errors let the host resolve customer-facing text through its presentation
 * registry (#5984).
 */
export type ScimFailureNotice = {
  error: unknown;
  fallbackTitle: string;
};

/** The query string the screen was opened with. */
export type ScimRouteReading = {
  query: Readonly<Record<string, string | undefined>>;
};

export abstract class ScimHostApi {
  /** The organization the tokens are minted against. */
  abstract organizationId(): string | undefined;

  /** The address an identity provider posts SCIM requests to. */
  abstract scimBaseUrl(): string;

  abstract succeeded(notice: ScimSuccessNotice): void;

  abstract failed(failure: ScimFailureNotice): void;

  abstract route(): ScimRouteReading;

  /** Replaces the whole query string; a key left out is a key removed. */
  abstract setQuery(next: Readonly<Record<string, string | undefined>>): void;
}

const ScimHostContext = createContext<ScimHostApi | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const ScimHostProvider = ScimHostContext.Provider;

export function useScimHost(): ScimHostApi {
  const host = useContext(ScimHostContext);
  if (!host) {
    throw new Error(
      "No SCIM host is mounted above this screen; render it inside the SCIM frontend feature.",
    );
  }
  return host;
}

/** Seeing the page is `sso:view`; minting a token takes `sso:manage` (ADR-122). */
export const SCIM_PAGE_PERMISSION = "sso:view";

/** Where the connectors live: the Authentication section's provisioning page. */
export const CONNECTORS_PAGE = "/settings/authentication/connectors";
