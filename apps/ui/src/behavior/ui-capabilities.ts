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
  abstract isFeatureEnabled(flag: string): boolean;
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

  isFeatureEnabled(): never {
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
  session: UiSessionPort;
};

/** What the composing application chose to answer itself. */
export type UiCapabilityInstall = Partial<UiCapabilities>;

export type UiCapabilityResolution = {
  install: UiCapabilityInstall;
  /** The default only the browser can build. */
  documentTitle: UiDocumentTitlePort;
  /** The default only router context can build. */
  navigation: UiNavigationPort;
};

/**
 * The install, completed. An installed port always wins over a default, so a
 * host that has a real toaster or a real session never gets the refusing one.
 */
export function resolveUiCapabilities({
  install,
  documentTitle,
  navigation,
}: UiCapabilityResolution): UiCapabilities {
  return {
    documentTitle: install.documentTitle ?? documentTitle,
    feedback: install.feedback ?? UNAVAILABLE_UI_FEEDBACK,
    navigation: install.navigation ?? navigation,
    session: install.session ?? UNAVAILABLE_UI_SESSION,
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
