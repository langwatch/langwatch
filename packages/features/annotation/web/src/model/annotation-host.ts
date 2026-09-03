/**
 * What the annotation screens ask of the application they are mounted in.
 *
 * ONE PORT FOR THE WHOLE FAMILY, declared here without importing anything of
 * the composing application's — the tenth port of the shape governance,
 * gateway, me, automations, ops, agents, datasets, model-config and RBAC each
 * wrote before it. Everything a page used to read off `useOrganizationTeamProject`,
 * `useRequiredSession`, `useRouter`, `useDrawer` and the toaster arrives through
 * these methods, which is what lets the screens move with their
 * `annotationApi.x.y.useQuery` call sites unchanged.
 *
 * WHAT THIS PORT DOES NOT HAVE, and deliberately: a `pathname`. The four page
 * keys are four views and the view arrives as a prop, so nothing on these
 * screens has to read the address to find out which list it is — see
 * `annotation-view.ts`. The one thing still read off the address is the queue
 * slug, which the router captured as a route PARAMETER.
 *
 * `isOwnPersonalWorkspace` is on the port for the same reason datasets put
 * `isLiteMember` on theirs: it is a column on the project rather than a grant,
 * so `hasPermission` cannot answer it, and the whole personal-workspace feature
 * gate turns on it. Answering it wrong in either direction is visible — `true`
 * gates a reader who is not on their own workspace out of the dataset hand-off,
 * and `false` sends a `personalWorkspaceFeatures.get` read that answers
 * NOT_FOUND for everyone else.
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
 * A short confirmation of something the reviewer just did.
 *
 * `action` is the datasets family's shape, taken for the same reason: the
 * shared feedback capability carries a title and a description and no action,
 * widening it is a change to a shared port that a page move does not own, and
 * this family has exactly one notice that needs a button — the send
 * confirmation, whose whole point is a way into wherever the traces landed. The
 * frontend feature renders it on the Design System toaster's own action
 * trigger. Everything without one still goes through the capability, so the
 * code-keyed copy still decides the words.
 */
export type AnnotationSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
  action?: { label: string; perform: () => void };
};

/**
 * A failure, as the screen knows it.
 *
 * The raw `error` travels, never a sentence the screen composed: the words a
 * customer reads are resolved from the error's `code` by the host's
 * presentation registry, and a screen that wrote its own would print the code
 * slug instead (#5984). `fallbackTitle` names the action that failed, so an
 * unrecognised code still says what the reviewer was doing.
 */
export type AnnotationFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

export abstract class AnnotationHostPort {
  /** The project in scope, or undefined before one resolves. */
  abstract project(): AnnotationHostProject | undefined;

  /** The organization the participants picker reads its members from. */
  abstract organizationId(): string | undefined;

  /** Who is signed in, or undefined before the session resolves. */
  abstract currentUser(): AnnotationHostUser | undefined;

  abstract hasPermission(permission: string): boolean;

  /**
   * Whether the reader holds the lite `EXTERNAL` membership role.
   *
   * The sidebar hides queue creation and queue editing from a lite member,
   * which is what `useLiteMemberGuard` decided on the platform layout.
   */
  abstract isLiteMember(): boolean;

  /**
   * Whether the project in scope is the reader's OWN personal workspace.
   *
   * The advanced-features bundle exists only there, so this is what decides
   * whether the dataset hand-off has to ask before it opens.
   */
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

const AnnotationHostContext = createContext<AnnotationHostPort | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const AnnotationHostProvider = AnnotationHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useAnnotationHost(): AnnotationHostPort {
  const host = useContext(AnnotationHostContext);
  if (!host) {
    throw new Error(
      "No annotations host is mounted above this screen; render it inside the annotation frontend feature.",
    );
  }
  return host;
}
