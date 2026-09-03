/**
 * What a screen may ask of the process it is mounted in — ADR-004 seals
 * off `document`, the router, the toaster and the session client, so a
 * screen asks ports instead. Missing ports refuse loudly, never silently.
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

/**
 * The one way out a failure offers, when there is one — a fix in a click
 * (open the plan with nothing runnable, configure the model provider).
 * `run`, not `onClick`: a port describes what happens, not the input device.
 */
export type UiFailureAction = {
  label: string;
  run: () => void;
};

/** A short confirmation of something the user just did. */
export type UiSuccessNotice = {
  title: string;
  description?: string;
  /** Dedupes repeats of the same action. */
  id?: string;
};

/**
 * A failure, as the screen knows it — the raw `error` travels, never a
 * message the screen composed: words are resolved from `error.code` by
 * the host's registry. `fallbackTitle` names the action, for when there's no code.
 */
export type UiFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  /**
   * A hard override of the headline, registry entry or not — rare, and
   * usually a smell: where the registry's copy is wrong, fix the registry
   * rather than one call site.
   */
  title?: string;
  /**
   * A sentence for a refusal the SCREEN made, not the server — ignored the
   * moment the error carries a code the registry can say something better
   * about. For failures with no code: a browser-side form guard, say.
   */
  description?: string;
  /**
   * The single fix this failure offers, as a button — belongs HERE rather
   * than a hand-rolled toast, so the failure keeps the registry's words
   * as well as the button. Stays rare: a re-run-what-just-failed button is noise.
   */
  action?: UiFailureAction;
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
 * The address a screen is rendering, as data — `useSearchParams` reaches
 * the router, sealed off by ADR-004. `setQuery` takes the WHOLE next
 * query, not a patch, so a screen can remove a key as well as set one.
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
 * Who is here, where they are, and what they may do — `hasPermission`
 * and `isFeatureEnabled` answer synchronously and fail closed, so a
 * loading screen renders the same as a "no" screen.
 */
export abstract class UiSessionPort {
  abstract currentUser(): UiActor | null;
  abstract activeScope(): UiActiveScope;
  abstract hasPermission(permission: string): boolean;

  /**
   * Whether the answers above have arrived — a guard needs the
   * difference `hasPermission` hides: "no" and "not asked yet" are the
   * same `false` to a screen, but must not be to a guard.
   */
  abstract isSettled(): boolean;

  /**
   * Whether a flag is on, off, or not yet answered — tri-state like
   * `isSettled`: a guard reading unanswered as off would flash its
   * not-found fallback on every load's first frame. Screens use {@link isFeatureEnabled}.
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
   * The default only a live host can build — absent for a composition
   * that declared no session source, when the refusal below is the honest answer.
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
 * Missing means the screen was mounted outside the application shell — a
 * composition fault, not something the screen can degrade around.
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
