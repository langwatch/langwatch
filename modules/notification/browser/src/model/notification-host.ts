/**
 * Host port for email-suppressions screen: project scope, manage permission,
 * and status notices.
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
 * Raw errors let the host resolve customer-facing text through its presentation
 * registry (#5984); fallbackTitle names the failed action.
 */
export type NotificationFailureNotice = {
  error: unknown;
  fallbackTitle: string;
};

export abstract class NotificationHostApi {
  /** The project in scope, or undefined before one resolves. */
  abstract project(): NotificationHostProject | undefined;

  abstract hasPermission(permission: string): boolean;

  abstract succeeded(notice: NotificationSuccessNotice): void;

  abstract failed(failure: NotificationFailureNotice): void;
}

const NotificationHostContext = createContext<NotificationHostApi | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const NotificationHostProvider = NotificationHostContext.Provider;

export function useNotificationHost(): NotificationHostApi {
  const host = useContext(NotificationHostContext);
  if (!host) {
    throw new Error(
      "No notification host is mounted above this screen; render it inside the notification frontend feature.",
    );
  }
  return host;
}

/** The narrower grant the remove button is behind, also unchanged. */
export const EMAIL_SUPPRESSIONS_MANAGE_PERMISSION = "triggers:manage";

/** The grant the platform page asked for, unchanged. */
export const EMAIL_SUPPRESSIONS_PAGE_PERMISSION = "triggers:view";
