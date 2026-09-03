/**
 * The handoff family's host port, answered from this application.
 *
 * `@langwatch/api-key-web` declares what `/authorize` and `/mcp/authorize` need
 * — the project, the session, the address, the two navigations plus the
 * third-party handoff, the base key, the project switcher, the MCP exchange and
 * the two notices — as one abstract class it can define without importing
 * anything of ours. This is the other half: a plain adapter over what the
 * application shell has already resolved.
 *
 * ## THE SCOPE GRAPH IS NOT WIDENED
 *
 * `UiScopeProject` carries an id, a slug and a name and no credential.
 * `/authorize`'s whole job is handing the reader that credential, and it still
 * does not come from the scope: it arrives here as its own reading, taken off
 * the same `organization.getAll` answer every other half of the product reads —
 * the same procedure, the same cache entry, and the same server-side
 * `project:update` redaction that decides who may hold one. A reader who may not
 * gets `undefined` and an empty field, which is what the platform page rendered
 * for a redacted key.
 */

import {
  AuthorizeHostPort,
  type AuthorizeFailureNotice,
  type AuthorizeRouteReading,
  type AuthorizeScope,
  type AuthorizeSessionStatus,
  type AuthorizeSuccessNotice,
  type McpAuthorizeAnswer,
  type McpAuthorizeRequest,
} from "@langwatch/api-key-web/screens/authorize";
import type { ReactNode } from "react";

export type AuthorizeHostReadings = {
  scope: AuthorizeScope;
  sessionStatus: AuthorizeSessionStatus;
  route: AuthorizeRouteReading;
  /** The active project's legacy base key, already redacted by the server. */
  projectApiKey: string | undefined;
  /** The control that chooses what is being authorized. */
  projectSwitcher: ReactNode;
};

export type AuthorizeHostActions = {
  navigate: (to: string) => void;
  replace: (to: string) => void;
  leaveTo: (url: string) => void;
  authorizeMcpClient: (request: McpAuthorizeRequest) => Promise<McpAuthorizeAnswer>;
  succeeded: (notice: AuthorizeSuccessNotice) => void;
  failed: (failure: AuthorizeFailureNotice) => void;
  writeClipboard: (text: string) => Promise<void>;
};

export class UiAuthorizeHost extends AuthorizeHostPort {
  static create(
    readings: AuthorizeHostReadings,
    actions: AuthorizeHostActions,
  ): UiAuthorizeHost {
    return new UiAuthorizeHost(readings, actions);
  }

  private constructor(
    private readonly readings: AuthorizeHostReadings,
    private readonly actions: AuthorizeHostActions,
  ) {
    super();
  }

  scope(): AuthorizeScope {
    return this.readings.scope;
  }

  sessionStatus(): AuthorizeSessionStatus {
    return this.readings.sessionStatus;
  }

  route(): AuthorizeRouteReading {
    return this.readings.route;
  }

  navigate(to: string): void {
    this.actions.navigate(to);
  }

  replace(to: string): void {
    this.actions.replace(to);
  }

  /**
   * Leaves for the MCP client's own callback.
   *
   * A full document replacement rather than a route change, because the address
   * is not ours: it is the `redirect_uri` the client registered, and completing
   * the OAuth flow means actually arriving there. The SCREEN has already checked
   * its scheme against the allowlist before this is called.
   */
  handOffTo(url: string): void {
    this.actions.leaveTo(url);
  }

  revealProjectApiKey(): string | undefined {
    // An empty string is what the server sends a reader who may not hold the
    // key; it is an absence rather than a key, and the screen renders it as one.
    return this.readings.projectApiKey || void 0;
  }

  projectSwitcher(): ReactNode {
    return this.readings.projectSwitcher;
  }

  authorizeMcpClient(request: McpAuthorizeRequest): Promise<McpAuthorizeAnswer> {
    return this.actions.authorizeMcpClient(request);
  }

  succeeded(notice: AuthorizeSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: AuthorizeFailureNotice): void {
    this.actions.failed(failure);
  }

  /**
   * The success notice only goes out once the write has actually resolved.
   *
   * On this page more than anywhere: telling a reader "copied" for a clipboard
   * write the browser refused sends them to a terminal with an empty paste and
   * a credential they think they have.
   */
  async copyToClipboard({
    text,
    succeeded,
  }: {
    text: string;
    succeeded: AuthorizeSuccessNotice;
  }): Promise<boolean> {
    try {
      await this.actions.writeClipboard(text);
      this.actions.succeeded(succeeded);
      return true;
    } catch (error) {
      this.actions.failed({
        error,
        fallbackTitle: "Failed to copy",
        description: "Couldn't copy. Please try again.",
      });
      return false;
    }
  }
}
