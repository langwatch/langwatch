/**
 * What the project Secrets screen asks of the application it is mounted in.
 *
 * A screen may not import `@langwatch/ui`, the router, a toast singleton or the
 * session client: those are the imports ADR-004 seals off from a feature-web
 * package. It asks this port instead, and the frontend feature that owns it —
 * `apps/ui/src/features/secret` — answers it by adapting the browser
 * capabilities the application resolves.
 *
 * THE TWELFTH HOST PORT OF THE SAME SHAPE, and the narrowest so far: one
 * project, one grant, two notices. Every family before this one recorded that
 * the repeat is the signal to promote the shape into one place, and every one
 * left it for the same reason — promotion changes packages a page move does not
 * own. Recorded again in `dev/docs/plans/ui-family-move-manifests.md`.
 *
 * WHAT THIS ONE ASKS THAT NO OTHER DID is `switchProject`. The platform page
 * carried `DashboardLayout`'s `ProjectSelector` in its header, because secrets
 * are per-project and the page is otherwise identical between them. A screen may
 * not mount the application's project switcher; the port declares the ability
 * and the frontend feature decides how to offer it.
 */

import { createContext, useContext } from "react";

/** The project the secrets on screen belong to. */
export type SecretHostScope = {
  projectId: string | undefined;
  projectName: string | undefined;
};

/** A short confirmation of something the reader just did. */
export type SecretSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as the screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: the wire
 * message of a handled error is its code slug, so a screen that wrote its own
 * copy would print the slug at the customer. `fallbackTitle` names the action
 * that failed, and `description` carries the one-line explanation this feature's
 * own refusal codes deserve — see `model/secret-refusal-copy.ts` for why the
 * screen has to supply it rather than the host looking it up.
 */
export type SecretFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  description?: string;
  id?: string;
};

/** The one thing the screen is handed. */
export abstract class SecretHostPort {
  /** The project these secrets belong to. */
  abstract scope(): SecretHostScope;

  /** Whether the reader holds a grant, answered synchronously and fail-closed. */
  abstract hasPermission(permission: string): boolean;

  abstract succeeded(notice: SecretSuccessNotice): void;

  abstract failed(failure: SecretFailureNotice): void;

  /**
   * Offers the reader a way to change which project they are looking at, or
   * `null` when the application has no switcher to offer.
   *
   * The platform page put `DashboardLayout`'s `ProjectSelector` in its header.
   * That component reaches the organization graph, the router and the shell's
   * own scope memory, none of which a screen may name — so what travels is the
   * ABILITY, and the application supplies the control.
   */
  abstract projectSwitcher(): React.ReactNode | null;
}

const SecretHostContext = createContext<SecretHostPort | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const SecretHostProvider = SecretHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useSecretHost(): SecretHostPort {
  const host = useContext(SecretHostContext);
  if (!host) {
    throw new Error(
      "No Secret host is mounted above this screen; render it inside the secret frontend feature.",
    );
  }
  return host;
}
