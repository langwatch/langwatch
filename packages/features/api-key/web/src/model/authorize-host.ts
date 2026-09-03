/**
 * What the two handoff screens ask the application that mounts them.
 *
 * `/authorize` and `/mcp/authorize` are ONE family — the pages where a reader
 * grants something outside the browser access to a project — and they are the
 * two the manifests held back longest. Three things blocked them and all three
 * are answered here.
 *
 * ## 1. THE PROJECT SWITCHER IS THE CONSENT CONTROL
 *
 * On both pages the switcher in the card header is HOW you choose what is being
 * authorized: which project's API key gets copied into a terminal, and which
 * project an MCP client is granted. Shipping them without it would be a consent
 * screen that cannot say what it is consenting for. It arrives as a `ReactNode`
 * off the port — the shape `@langwatch/navigation-web`'s chrome established, and
 * what `@langwatch/organization-web` and `@langwatch/secret-web` already use —
 * so the screen decides where in its own header it goes.
 *
 * ## 2. `revealProjectApiKey()` IS A QUESTION, NOT A FIELD ON THE SCOPE
 *
 * `/authorize` prints `project.apiKey`. `apps/ui`'s scope graph carries ids,
 * names and slugs and NO key, deliberately: the base key is a project-level
 * write credential, `organization.getAll` redacts it to `""` server-side for
 * anyone without `project:update`, and widening the shell's graph to carry it
 * would put a credential in front of every surface that reads a scope. So the
 * key is asked for by name, off the SAME procedure under the SAME permission
 * check, and a reader who may not hold one gets `undefined` and an empty field —
 * exactly what the platform page rendered for a redacted key.
 *
 * ## 3. THE MCP EXCHANGE IS A REST CALL, AND IT STAYS THE APPLICATION'S
 *
 * `/mcp/authorize` POSTs to `/api/mcp/authorize`, an address the MCP client on
 * the other side is waiting on. A browser transport belongs in
 * `apps/ui/src/behavior`, which is where the `/cli/auth` device-flow exchange
 * went for the same reason, so the port takes the ANSWER rather than the wire.
 *
 * WHAT IS NOT ON THIS PORT is the redirect-scheme check. `model/redirect-schemes`
 * is in this package, moved verbatim, and the screen calls it directly: it is the
 * second lock behind the server's own registry check, and a lock that can be
 * answered differently by different hosts is not a lock.
 */

import { createContext, useContext, type ReactNode } from "react";

/** The project a grant is about. */
export type AuthorizeScope = {
  readonly projectId: string | undefined;
  readonly projectName: string | undefined;
};

export type AuthorizeSessionStatus = "loading" | "authenticated" | "unauthenticated";

export type AuthorizeRouteReading = {
  readonly pathname: string;
  readonly query: Readonly<Record<string, string | undefined>>;
};

/** What our own authorize endpoint answered, in RFC 6749 §4.1.2.1 terms. */
export type McpAuthorizeAnswer = {
  readonly ok: boolean;
  /** Where to send the reader. Verified against the client registry server-side. */
  readonly redirect?: string;
  readonly error?: string;
  readonly error_description?: string;
};

export type McpAuthorizeRequest = {
  readonly projectId: string;
  readonly redirect_uri: string;
  readonly state: string;
  readonly code_challenge: string;
  readonly code_challenge_method: string;
  readonly client_id: string;
};

export type AuthorizeFailureNotice = {
  /**
   * The failure itself, which the composition's presentation registry turns
   * into the sentence a customer reads. Required rather than optional, and the
   * shape `UiFeedbackPort` takes: a notice with no error degrades to the generic
   * line for a failure we could have named.
   */
  readonly error: unknown;
  /** What the reader was doing, for a code the registry does not list. */
  readonly fallbackTitle: string;
  /** A sentence for a refusal the SCREEN made rather than the server. */
  readonly description?: string;
};

export type AuthorizeSuccessNotice = {
  readonly title: string;
  readonly description?: string;
};

export abstract class AuthorizeHostPort {
  abstract scope(): AuthorizeScope;

  abstract sessionStatus(): AuthorizeSessionStatus;

  abstract route(): AuthorizeRouteReading;

  /** A client transition inside this application. */
  abstract navigate(to: string): void;

  abstract replace(to: string): void;

  /**
   * Leaves for an address this application does not own.
   *
   * Separate from `navigate` on purpose: the MCP flow ends by handing the reader
   * to the client's own callback, which is a third-party address and never a
   * route. The screen checks the scheme before calling this; the host performs
   * the navigation because a feature may not touch `window.location`.
   */
  abstract handOffTo(url: string): void;

  /**
   * The project's legacy base key, or `undefined` when the reader may not hold
   * it. See the module docblock: this is a question, not a scope field.
   */
  abstract revealProjectApiKey(): string | undefined;

  /**
   * The control that chooses what is being authorized.
   *
   * `null` only if a composition has no workspace graph to switch within, which
   * for these two addresses would be a composition fault rather than a state.
   */
  abstract projectSwitcher(): ReactNode;

  /** Exchanges the OAuth parameters for a redirect, or for a stated failure. */
  abstract authorizeMcpClient(request: McpAuthorizeRequest): Promise<McpAuthorizeAnswer>;

  abstract succeeded(notice: AuthorizeSuccessNotice): void;

  abstract failed(failure: AuthorizeFailureNotice): void;

  /** Writes to the clipboard and says the right thing either way. */
  abstract copyToClipboard(input: {
    text: string;
    succeeded: AuthorizeSuccessNotice;
  }): Promise<boolean>;
}

const AuthorizeHostContext = createContext<AuthorizeHostPort | undefined>(void 0);

/** Publishes the host to the two handoff screens. */
export const AuthorizeHostProvider = AuthorizeHostContext.Provider;

/**
 * The host these screens are mounted in.
 *
 * Missing means a screen was rendered outside the frontend feature that owns it,
 * which is a composition fault rather than something a consent screen can
 * degrade around — and degrading around it would mean granting access without
 * being able to name what is being granted.
 */
export function useAuthorizeHost(): AuthorizeHostPort {
  const host = useContext(AuthorizeHostContext);
  if (!host) {
    throw new Error(
      "No authorize host is mounted above this screen; render it inside the authorize frontend feature.",
    );
  }
  return host;
}
