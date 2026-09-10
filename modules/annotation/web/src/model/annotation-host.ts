/**
 * What the annotation screens ask of the application they are mounted in: one
 * port for the whole family, with no `pathname` (the view arrives as a prop, see
 * `annotation-view.ts`; the queue slug is a route parameter).
 */

import { createContext, useContext } from "react";

/** The project every annotation read is scoped to. */
export type AnnotationHostProject = {
  id: string;
  slug: string;
  name: string;
};

/** Who is reviewing, as the sidebar and the reviewer's own queue need them. */
export type AnnotationHostUser = {
  id: string;
  name: string | null;
  image: string | null;
};

/** The path parameters and query string a screen was opened with. */
export type AnnotationRouteReading = {
  /** The `:slug` style segments the matched route captured. */
  params: Readonly<Record<string, string | undefined>>;
  /** The query string, single-valued — the last write of a repeated key wins. */
  query: Readonly<Record<string, string | undefined>>;
};

/**
 * A short confirmation of something the reviewer just did. `action` is the one
 * button a notice may carry (the send confirmation's way into the traces).
 */
export type AnnotationSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
  action?: { label: string; perform: () => void };
};

/**
 * A failure, as the screen knows it. The raw `error` travels and the host
 * resolves the words from its `code`; `fallbackTitle` names the action that failed.
 */
export type AnnotationFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

export abstract class AnnotationHostApi {
  /** The project in scope, or undefined before one resolves. */
  abstract project(): AnnotationHostProject | undefined;

  /** The organization the participants picker reads its members from. */
  abstract organizationId(): string | undefined;

  /** Who is signed in, or undefined before the session resolves. */
  abstract currentUser(): AnnotationHostUser | undefined;

  abstract hasPermission(permission: string): boolean;

  /** Whether the reader holds the lite `EXTERNAL` role; the sidebar hides queue editing from them. */
  abstract isLiteMember(): boolean;

  /** Whether the project is the reader's own personal workspace; the dataset hand-off asks first there. */
  abstract isOwnPersonalWorkspace(): boolean;

  abstract route(): AnnotationRouteReading;

  /** Replaces the WHOLE query, so a screen can remove a key as well as set one. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract navigate(to: string): void;

  abstract succeeded(notice: AnnotationSuccessNotice): void;

  abstract failed(failure: AnnotationFailureNotice): void;
}

const AnnotationHostContext = createContext<AnnotationHostApi | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const AnnotationHostProvider = AnnotationHostContext.Provider;

/** The host this screen is mounted in; missing is a composition fault, so it throws. */
export function useAnnotationHost(): AnnotationHostApi {
  const host = useContext(AnnotationHostContext);

  if (!host) {
    throw new Error(
      "No annotations host is mounted above this screen; render it inside the annotation frontend feature.",
    );
  }

  return host;
}
