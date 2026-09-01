/**
 * What a screen may ask of the process it is mounted in.
 *
 * A screen must not reach for the browser's document, a toast singleton, the
 * router or the session client: those are the imports ADR-004 seals off from
 * `src/features/*`, and reaching for them is also what makes a screen
 * untestable outside a running application. It asks these ports instead, and
 * the composition root decides who answers.
 *
 * Two of the four have an implementation this package can write on its own:
 * the document title is `document.title`, and navigation is the router
 * `apps/ui` already owns (`ui-router-navigation`). The other two need
 * something only the host has — a toast renderer wired to the code-keyed
 * error copy, and the session, organization and project a request is about.
 * Until a host supplies them, their default refuses loudly rather than
 * pretending: a swallowed error message and a silently empty permission set
 * are both worse than a stack trace naming the capability.
 */

import { createContext, useContext } from "react";

/** The composition never filled this port, and something asked it to work. */
export class UiCapabilityUnavailableError extends Error {
  constructor(readonly capability: string) {
    super(
      `The ${JSON.stringify(capability)} UI capability has no implementation in this composition. ` +
        "Supply it through createUiApplication({ features: { capabilities } }).",
    );
    this.name = "UiCapabilityUnavailableError";
  }
}

/** Sets the browser tab's title, and hands back the way to put it back. */
export abstract class UiDocumentTitlePort {
  abstract set(title: string): () => void;
}

/** A short confirmation of something the user just did. */
export type UiSuccessNotice = {
  title: string;
  description?: string;
  /** Dedupes repeats of the same action. */
  id?: string;
};

/**
 * A failure, as the screen knows it.
 *
 * The raw `error` travels, never a message the screen composed: the words a
 * customer reads are resolved from the error's `code` by the host's
 * presentation registry, and a screen that wrote its own sentence would print
 * the code slug instead. `fallbackTitle` names the action that failed, so an
 * unrecognised code still says what the user was doing.
 */
export type UiFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

/** Tells the user how something they did turned out. */
export abstract class UiFeedbackPort {
  abstract succeeded(notice: UiSuccessNotice): void;
  abstract failed(failure: UiFailureNotice): void;
}

/** Moves the address bar. */
export abstract class UiNavigationPort {
  abstract navigate(to: string): void;
  abstract replace(to: string): void;
  abstract back(): void;
}

/** The path parameters and query string a screen was opened with. */
export type UiRouteReadingValues = {
  /** The `:id` style segments the matched route captured. */
  params: Readonly<Record<string, string | undefined>>;
  /** The query string, single-valued — the last write of a repeated key wins. */
  query: Readonly<Record<string, string | undefined>>;
};

/**
 * The address a screen is rendering, as data.
 *
 * A screen that reads `useSearchParams` reaches the router, which is one of the
 * imports ADR-004 seals off; it asks this instead. `setQuery` takes the WHOLE
 * next query rather than a patch, because a screen that keeps view state in the
 * URL has to be able to remove a key as well as set one.
 */
export abstract class UiRoutePort {
  abstract reading(): UiRouteReadingValues;
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;
}

/** Who is signed in, as a screen needs to know them. */
export type UiActor = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

/** The organization and project the current page is about. */
export type UiActiveScope = {
  organizationId: string | null;
  projectId: string | null;
};

/**
 * Who is here, where they are, and what they may do.
 *
 * `hasPermission` and `isFeatureEnabled` answer synchronously and fail closed,
 * so a screen renders the same way while the answer is still loading as it
 * does when the answer is no.
 */
export abstract class UiSessionPort {
  abstract currentUser(): UiActor | null;
  abstract activeScope(): UiActiveScope;
  abstract hasPermission(permission: string): boolean;

  /**
   * Whether the answers above have arrived for the current scope.
   *
   * A page guard needs the difference that `hasPermission` deliberately hides:
   * "no, you may not" and "we have not asked yet" are the same `false` to a
   * screen, and must not be the same to the guard that would otherwise show a
   * refusal notice for a frame to everyone who has the grant.
   */
  abstract isSettled(): boolean;

  /**
   * Whether a flag is on, off, or not yet answered.
   *
   * The tri-state exists for the same reason as `isSettled`: a guard that reads
   * an unanswered flag as off renders its not-found fallback on the first frame
   * of every load. A screen wants the two-state answer and uses
   * {@link isFeatureEnabled}.
   */
  abstract featureFlag(flag: string): boolean | undefined;

  /** Fail-closed: not yet answered reads the same as off. */
  isFeatureEnabled(flag: string): boolean {
    return this.featureFlag(flag) === true;
  }
}

class UnavailableUiFeedback extends UiFeedbackPort {
  succeeded(): never {
    throw new UiCapabilityUnavailableError("feedback");
  }

  failed(): never {
    throw new UiCapabilityUnavailableError("feedback");
  }
}

class UnavailableUiSession extends UiSessionPort {
  currentUser(): never {
    throw new UiCapabilityUnavailableError("session");
  }

  activeScope(): never {
    throw new UiCapabilityUnavailableError("session");
  }

  hasPermission(): never {
    throw new UiCapabilityUnavailableError("session");
  }

  isSettled(): never {
    throw new UiCapabilityUnavailableError("session");
  }

  featureFlag(): never {
    throw new UiCapabilityUnavailableError("session");
  }

  override isFeatureEnabled(): never {
    throw new UiCapabilityUnavailableError("session");
  }
}

/** The default for a port with no implementation this package can write. */
export const UNAVAILABLE_UI_FEEDBACK: UiFeedbackPort = new UnavailableUiFeedback();
export const UNAVAILABLE_UI_SESSION: UiSessionPort = new UnavailableUiSession();

/** The title of the document this application is rendered into. */
export class BrowserUiDocumentTitle extends UiDocumentTitlePort {
  static create(target: Pick<Document, "title"> = document): BrowserUiDocumentTitle {
    return new BrowserUiDocumentTitle(target);
  }

  private constructor(private readonly target: Pick<Document, "title">) {
    super();
  }

  set(title: string): () => void {
    const previous = this.target.title;
    this.target.title = title;
    return () => {
      this.target.title = previous;
    };
  }
}

/** Every capability a screen can ask for, all of them answered. */
export type UiCapabilities = {
  documentTitle: UiDocumentTitlePort;
  feedback: UiFeedbackPort;
  navigation: UiNavigationPort;
  route: UiRoutePort;
  session: UiSessionPort;
};

/** What the composing application chose to answer itself. */
export type UiCapabilityInstall = Partial<UiCapabilities>;

export type UiCapabilityResolution = {
  install: UiCapabilityInstall;
  /** The default only the browser can build. */
  documentTitle: UiDocumentTitlePort;
  /** The defaults only router context can build. */
  navigation: UiNavigationPort;
  route: UiRoutePort;
  /**
   * The default only a live host can build: the reader, the scope and what
   * they may do, all read from the deployment this page came from. Absent for
   * a composition that declared no session source, and the refusal below is
   * then the honest answer.
   */
  session?: UiSessionPort;
};

/**
 * The install, completed. An installed port always wins over a default, so a
 * host that has a real toaster or a real session never gets the refusing one.
 */
export function resolveUiCapabilities({
  install,
  documentTitle,
  navigation,
  route,
  session,
}: UiCapabilityResolution): UiCapabilities {
  return {
    documentTitle: install.documentTitle ?? documentTitle,
    feedback: install.feedback ?? UNAVAILABLE_UI_FEEDBACK,
    navigation: install.navigation ?? navigation,
    route: install.route ?? route,
    session: install.session ?? session ?? UNAVAILABLE_UI_SESSION,
  };
}

const UiCapabilityContext = createContext<UiCapabilities | undefined>(void 0);

/** Publishes the resolved capabilities to everything a screen renders. */
export const UiCapabilityContextProvider = UiCapabilityContext.Provider;

/**
 * The capabilities of the process this screen is running in.
 *
 * Missing means the screen was mounted outside the application shell, which is
 * a composition fault and not something the screen can degrade around.
 */
export function useUiCapabilities(): UiCapabilities {
  const capabilities = useContext(UiCapabilityContext);
  if (!capabilities) {
    throw new Error(
      "No UI capabilities are mounted above this screen; render it inside the application shell.",
    );
  }
  return capabilities;
}
