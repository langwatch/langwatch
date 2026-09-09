/**
 * What the email-suppressions screen asks of the application it is mounted in.
 *
 * The same port shape every settings family since governance has written. Two
 * questions and two notices: which project the list is about, whether the
 * reader may undo an entry, and how a removal turned out.
 *
 * `canManage` is a GRANT and is deliberately not folded into a boolean the
 * screen computes: `triggers:view` opens the page and `triggers:manage` shows
 * the remove button, which is exactly the split the platform page made.
 */

import { createContext, useContext } from "react";

/** The project every suppression read is scoped to. */
export type NotificationHostProject = {
  id: string;
};

export type NotificationSuccessNotice = {
  title: string;
  description?: string;
};

/**
 * A failure, as the screen knows it.
 *
 * The raw `error` travels, never a sentence the screen composed: the words a
 * customer reads are resolved from the error's `code` by the host's
 * presentation registry (#5984). `fallbackTitle` names the action that failed.
 */
export type NotificationFailureNotice = {
  error: unknown;
  fallbackTitle: string;
};

export abstract class NotificationHostPort {
  /** The project in scope, or undefined before one resolves. */
  abstract project(): NotificationHostProject | undefined;

  abstract hasPermission(permission: string): boolean;

  abstract succeeded(notice: NotificationSuccessNotice): void;

  abstract failed(failure: NotificationFailureNotice): void;
}

const NotificationHostContext = createContext<NotificationHostPort | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const NotificationHostProvider = NotificationHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useNotificationHost(): NotificationHostPort {
  const host = useContext(NotificationHostContext);
  if (!host) {
    throw new Error(
      "No notification host is mounted above this screen; render it inside the notification frontend feature.",
    );
  }
  return host;
}
