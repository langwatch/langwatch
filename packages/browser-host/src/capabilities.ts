/**
 * What a screen may ask of the process it is mounted in — ADR-004 seals
 * off `document`, the router, the toaster and the session client, so a
 * screen asks ports instead. Missing ports refuse loudly, never silently.
 */

import { createContext, useContext } from "react";

import type { UiAnalytics } from "./analytics.ts";
import { NO_UI_DECLARATIONS, type UiDeclarations } from "./declarations.ts";
import { UNAVAILABLE_UI_SCOPE, UiScope, useUiScope, type UiActiveScope } from "./scope.ts";
import type { UiSessionSnapshot } from "./session.ts";
import type { UiSlots } from "./slots.tsx";
import type { UiFeatureApiTransport } from "./transport.ts";

/** Scope is a capability of its own; this file stays the one ports barrel. */
export { UiScope, UNAVAILABLE_UI_SCOPE, useUiScope, type UiActiveScope };

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
export abstract class UiDocumentTitle {
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
export abstract class UiFeedback {
  abstract succeeded(notice: UiSuccessNotice): void;
  abstract failed(failure: UiFailureNotice): void;
}

/** What a live procedure hands its subscriber, one entry at a time. */
export type UiRpcSubscriptionHandlers = {
  onData?: (value: unknown) => void;
  onError?: (error: unknown) => void;
  onStarted?: () => void;
  onStopped?: () => void;
};

/** A live procedure, while somebody is listening to it. */
export type UiRpcSubscription = { unsubscribe: () => void };

/**
 * A procedure call addressed by path rather than by a typed hook, for a
 * surface covering many procedures behind one path string. A typed hook off
 * the module's derived client is normal; this is the shell-composed escape.
 */
export abstract class UiRpc {
  abstract query(path: string, input: unknown): Promise<unknown>;

  abstract mutate(path: string, input: unknown): Promise<unknown>;

  /** A LIVE procedure, opened from outside React. Nothing is cached. */
  abstract subscribe(
    path: string,
    input: unknown,
    handlers: UiRpcSubscriptionHandlers,
  ): UiRpcSubscription;
}

/** Moves the address bar. */
export abstract class UiNavigation {
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
  /**
   * The path the reader is on, without query or fragment. Optional because a
   * test that hands over a reading rarely has one; `useRouter` reads it as the
   * empty string when it is absent.
   */
  pathname?: string;
};

/**
 * The address a screen is rendering, as data — `useSearchParams` reaches
 * the router, sealed off by ADR-004. `setQuery` takes the WHOLE next
 * query, not a patch, so a screen can remove a key as well as set one.
 */
export abstract class UiRoute {
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

/**
 * Who is here and what they may do — `hasPermission` and `isFeatureEnabled`
 * answer synchronously and fail closed, so a loading screen renders the same
 * as a "no" screen. Where they are is `UiScope`, a capability of its own.
 */
export abstract class UiSession {
  abstract currentUser(): UiActor | null;
  abstract hasPermission(permission: string): boolean;

  /**
   * Whether the answers above have arrived — a guard needs the
   * difference `hasPermission` hides: "no" and "not asked yet" are the
   * same `false` to a screen, but must not be to a guard.
   */
  abstract isSettled(): boolean;

  /**
   * The shell's single session, scope and grant reading. Legacy ports that do
   * not publish it fail by name instead of fabricating an auth state.
   */
  snapshot(): UiSessionSnapshot {
    throw new UiCapabilityUnavailableError("session snapshot");
  }

  /**
   * Whether a flag is on, off, or not yet answered — tri-state so a guard
   * reading unanswered as off does not flash its fallback on first load.
   */
  abstract featureFlag(flag: string): boolean | undefined;

  /** Fail-closed: not yet answered reads the same as off. */
  isFeatureEnabled(flag: string): boolean {
    return this.featureFlag(flag) === true;
  }
}

class UnavailableUiFeedback extends UiFeedback {
  succeeded(): never {
    throw new UiCapabilityUnavailableError("feedback");
  }

  failed(): never {
    throw new UiCapabilityUnavailableError("feedback");
  }
}

class UnavailableUiSession extends UiSession {
  currentUser(): never {
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

class UnavailableUiRpc extends UiRpc {
  query(): never {
    throw new UiCapabilityUnavailableError("rpc");
  }

  mutate(): never {
    throw new UiCapabilityUnavailableError("rpc");
  }

  subscribe(): never {
    throw new UiCapabilityUnavailableError("rpc");
  }
}

/** The default for a port with no implementation this package can write. */
export const UNAVAILABLE_UI_FEEDBACK: UiFeedback = new UnavailableUiFeedback();
export const UNAVAILABLE_UI_RPC: UiRpc = new UnavailableUiRpc();
export const UNAVAILABLE_UI_SESSION: UiSession = new UnavailableUiSession();

/** The title of the document this application is rendered into. */
export class BrowserUiDocumentTitle extends UiDocumentTitle {
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

/**
 * Which build a screen is running in, as the composing application knows it.
 * Only `apps/ui` can read that; a screen asks for the reading instead.
 */
export type UiDeployment = {
  /** A local development build: dev-only affordances and raw error text. */
  isDevelopment: boolean;
  /** The hosted product rather than a self-hosted one. */
  isSaaS: boolean;
  /**
   * This deployment's own address. Required, not optional: a host that must
   * answer one has no honest absence, and `""` renders a link that looks real.
   */
  appBaseUrl: string;
  /** The shared demo project, when this deployment configures one. */
  demoProjectSlug?: string;
  /** Where a licence is bought, when this deployment sells one. */
  licensePaymentUrl?: string;
  hasNlpService: boolean;
  hasLangevals: boolean;
  /**
   * Whether this deployment can actually send mail. Required, not optional: a
   * host answering `false` where mail works tells an administrator their invite
   * was not sent when it was.
   */
  hasEmailProvider: boolean;
};

/** What a composition that declared no deployment is read as. */
const PRODUCTION_UI_DEPLOYMENT: UiDeployment = {
  isDevelopment: false,
  isSaaS: false,
  // The composition that declared no deployment declared no address either;
  // the document's own origin is the one answer that is never a guess.
  appBaseUrl: typeof window === "undefined" ? "" : window.location.origin,
  hasNlpService: true,
  hasLangevals: true,
  hasEmailProvider: false,
};

/** Every capability a screen can ask for, all of them answered. */
export type UiCapabilities = {
  /**
   * Where every module's named events go. Absent and "installed no
   * destination" are the same reading — `useUiAnalytics` degrades to the
   * inert destination either way, exactly as `useUiSlots` does.
   */
  analytics?: UiAnalytics;
  /**
   * What installed modules declared through `withCapabilities`. Optional:
   * absent reads as nothing declared, exactly as `slots` does.
   */
  declarations?: UiDeclarations;
  /**
   * Optional so a hand-built capability set stays valid without one;
   * {@link resolveUiCapabilities} always fills it, production when absent.
   */
  deployment?: UiDeployment;
  documentTitle: UiDocumentTitle;
  feedback: UiFeedback;
  navigation: UiNavigation;
  route: UiRoute;
  /**
   * The by-path dispatcher, for the few surfaces too wide for a procedure
   * map. Optional so a hand-built capability set stays valid without one;
   * absent reads as the refusing dispatcher, exactly as `session` does.
   */
  rpc?: UiRpc;
  /**
   * Where the reader is standing. Optional so a hand-built capability set
   * stays valid without one; absent reads as the refusing port, exactly as
   * `rpc` does.
   */
  scope?: UiScope;
  session: UiSession;
  /**
   * The blocks a core screen leaves for the composition to fill. Optional
   * because absent and "filled nothing" are the same reading — `useUiSlots`
   * degrades to the core defaults either way.
   */
  slots?: UiSlots;
};

/** What the composing application chose to answer itself. */
export type UiCapabilityInstall = Partial<UiCapabilities>;

export type UiCapabilityResolution = {
  install: UiCapabilityInstall;
  /** The default only the browser can build. */
  documentTitle: UiDocumentTitle;
  /** The defaults only router context can build. */
  navigation: UiNavigation;
  route: UiRoute;
  /**
   * The default only the composition can build: the dispatcher needs both the
   * transport and the one QueryClient, neither of which a screen may reach.
   */
  rpc?: UiRpc;
  /** The scope that same live host resolved, beside the session it came with. */
  scope?: UiScope;
  /**
   * The default only a live host can build — absent for a composition
   * that declared no session source, when the refusal below is the honest answer.
   */
  session?: UiSession;
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
  rpc,
  scope,
  session,
}: UiCapabilityResolution): UiCapabilities {
  return {
    analytics: install.analytics,
    declarations: install.declarations,
    deployment: install.deployment ?? PRODUCTION_UI_DEPLOYMENT,
    documentTitle: install.documentTitle ?? documentTitle,
    feedback: install.feedback ?? UNAVAILABLE_UI_FEEDBACK,
    navigation: install.navigation ?? navigation,
    route: install.route ?? route,
    rpc: install.rpc ?? rpc ?? UNAVAILABLE_UI_RPC,
    scope: install.scope ?? scope ?? UNAVAILABLE_UI_SCOPE,
    session: install.session ?? session ?? UNAVAILABLE_UI_SESSION,
    slots: install.slots,
  };
}

const UiCapabilityContext = createContext<UiCapabilities | undefined>(void 0);

/** Publishes the resolved capabilities to everything a screen renders. */
export const UiCapabilityContextProvider = UiCapabilityContext.Provider;

/**
 * The capabilities above this screen, or undefined where none are mounted.
 * The hooks this package publishes over the ports read this one rather than
 * {@link useUiCapabilities}, degrading to an inert reading instead of a crash.
 */
export function useOptionalUiCapabilities(): UiCapabilities | undefined {
  return useContext(UiCapabilityContext);
}

/**
 * The build this screen is running in. A screen mounted with no shell above
 * it reads production, the same fail-closed reading every other port gives.
 */
export function useUiDeployment(): UiDeployment {
  return useOptionalUiCapabilities()?.deployment ?? PRODUCTION_UI_DEPLOYMENT;
}

/** What installed modules declared, degrading to none outside a shell. */
export function useUiDeclarations(): UiDeclarations {
  return useOptionalUiCapabilities()?.declarations ?? NO_UI_DECLARATIONS;
}

/**
 * The by-path dispatcher of the process this screen is running in. Read off
 * the capabilities rather than a context of its own: record 10.1 rules out
 * ambient React context as a cross-module transport.
 */
export function useUiRpc(): UiRpc {
  return useOptionalUiCapabilities()?.rpc ?? UNAVAILABLE_UI_RPC;
}

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

/** What a composition's session read yields: the two capabilities together. */
export type UiSessionCapabilities = { session: UiSession; scope: UiScope };

/**
 * A composition's live session, built where the transport is — declared as a
 * source (a hook, called once) rather than a port, since the answer changes as
 * the reader navigates and the reads land.
 */
export type UiSessionSource = (input: {
  transport: UiFeatureApiTransport;
  /** Where a refused session read is told, since nobody else sees it. */
  feedback: UiFeedback;
}) => UiSessionCapabilities;
