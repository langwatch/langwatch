/**
 * What the automations screen asks of the application it is mounted in.
 *
 * A screen may not import `@langwatch/ui`, the router, a toast singleton or the
 * session client: those are the imports ADR-004 seals off from a feature-web
 * package, and reaching for any of them is also what would make this screen
 * untestable outside a running application. It asks this port instead, and the
 * frontend feature that owns it — `apps/ui/src/features/automations` — answers
 * it by adapting the browser capabilities the application already resolves.
 *
 * It lives in `model` because it is a package-wide portable value: types plus
 * the React context they travel in, depending on nothing but React.
 *
 * THE FOURTH FAMILY TO DECLARE THIS SHAPE, after `GovernanceHostPort`,
 * `GatewayHostPort` and `PersonalWorkspaceHostPort`. The comment on the second
 * said a third repeat is the signal to promote them; the third said the same
 * and left it, and so does this one, for the same reason: promotion is a change
 * to four packages this move does not own, and doing it inside a page-family
 * move would hide it. Recorded in `dev/docs/plans/ui-family-move-manifests.md`.
 *
 * What this family asks that the other three did not: `isFeatureEnabled` alone
 * is not enough for the webhook channel. A prefill that names `SEND_WEBHOOK`
 * must not be dropped merely because the flag has not answered yet, so the port
 * hands over the tri-state — `undefined` while the answer is still arriving —
 * and the screen decides. `isFeatureEnabled` stays as the fail-closed reading
 * every other surface wants.
 */

import { createContext, useContext } from "react";

/** The organization, team and project the current page is about. */
export type AutomationScope = {
  organizationId: string | null;
  teamId: string | null;
  projectId: string | null;
};

/** The organization the reader is standing in. */
export type AutomationOrganization = {
  id: string;
  name: string;
  slug: string;
};

export type AutomationTeam = {
  id: string;
  name: string;
  slug: string;
};

/** The project every automation in this family belongs to. */
export type AutomationProject = {
  id: string;
  name: string;
  slug: string;
};

/** The path parameters and query string the screen was opened with. */
export type AutomationRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/** A short confirmation of something the reader just did. */
export type AutomationSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as the screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: since the
 * wire message of a handled error is its code slug, a screen that wrote its own
 * copy would print the slug at the customer. `fallbackTitle` names the action
 * that failed, so an unrecognised code still says what the reader was doing.
 */
export type AutomationFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  /** Overrides the title outright, for a code the screen can name better. */
  title?: string;
  id?: string;
};

/**
 * The one thing a screen is handed.
 *
 * Methods rather than an object of loose functions, so the adapter is a class
 * the frontend feature constructs once and a test double is an obvious object
 * literal.
 */
export abstract class AutomationHostPort {
  /** The organization, team and project this page is about. */
  abstract scope(): AutomationScope;

  abstract organization(): AutomationOrganization | undefined;

  abstract team(): AutomationTeam | undefined;

  /** The project the address is about. Automations are project-scoped. */
  abstract project(): AutomationProject | undefined;

  /** Fails closed: an answer that has not arrived reads as no. */
  abstract hasPermission(permission: string): boolean;

  /** Fails closed the same way. */
  abstract isFeatureEnabled(flag: string): boolean;

  /**
   * The same flag, undecided included.
   *
   * `undefined` means the answer has not arrived. Only one surface needs the
   * difference — a `SEND_WEBHOOK` prefill must wait rather than be dropped —
   * and everything else reads `isFeatureEnabled`.
   */
  abstract featureFlag(flag: string): boolean | undefined;

  abstract route(): AutomationRouteReading;

  /** Replaces the whole query string; a key left out is a key removed. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract navigate(to: string): void;

  /**
   * The application's own address, for the links a rendered preview prints.
   *
   * `platform/app` read `window.location.origin` inside the drawer. A screen
   * may read the document it is rendered in, but the example URLs a preview
   * prints are a property of the deployment rather than of the browser tab, so
   * they come from the host and a test can state them.
   */
  abstract appBaseUrl(): string;

  abstract succeeded(notice: AutomationSuccessNotice): void;

  abstract failed(failure: AutomationFailureNotice): void;

  /** One line of copy for a failure, for the surfaces too tight for a toast. */
  abstract describeFailure(failure: AutomationFailureNotice): string;
}

const AutomationHostContext = createContext<AutomationHostPort | undefined>(void 0);

/** Publishes the host to every automations screen and drawer below it. */
export const AutomationHostProvider = AutomationHostContext.Provider;

/**
 * The application this screen is running in.
 *
 * Missing means the screen was mounted outside its frontend feature, which is a
 * composition fault rather than something the screen can degrade around.
 */
export function useAutomationHost(): AutomationHostPort {
  const host = useContext(AutomationHostContext);
  if (!host) {
    throw new Error(
      "No automation host is mounted above this screen; render it inside the automations frontend feature.",
    );
  }
  return host;
}
