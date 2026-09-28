/**
 * Prompt's answer to the port its screen declares: every method projects a
 * `@langwatch/browser-host` capability. `projectApiKey` reads honestly empty:
 * no key capability exists yet; organization lends `copyTargets`. §10.1.
 */

import {
  useUiCapabilities,
  useUiCopyTargets,
  useUiScope,
  type UiCopyTargets,
  type UiFeedback,
  type UiNavigation,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import type { UiScopeHost } from "@langwatch/browser-host/use-organization-team-project";
import { useMemo, type ReactNode } from "react";

import type { PromptBrowserLogger, PromptTabsCapabilities } from "../model/browser-capabilities.ts";
import {
  PromptHostApi,
  PromptHostProvider,
  type PromptCopyTarget,
  type PromptFailureNotice,
  type PromptHostScope,
  type PromptPlatformDrawer,
  type PromptPlaygroundChatAvailability,
  type PromptRouteReading,
  type PromptSuccessNotice,
} from "../model/prompt-host.ts";

/** Writes a `platform/app` drawer's address, clearing stale `drawer.*` keys. */
function openDrawerAddress({
  drawer,
  params,
  route,
}: {
  drawer: string;
  params?: Readonly<Record<string, string | undefined>>;
  route: UiRoute;
}): void {
  const next: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(route.reading().query)) {
    next[key] = key.startsWith("drawer.") ? void 0 : value;
  }
  next["drawer.open"] = drawer;
  for (const [key, value] of Object.entries(params ?? {})) next[`drawer.${key}`] = value;
  route.setQuery(next);
}

const promptBrowserLogger: PromptBrowserLogger = {
  info: (...args: unknown[]) => console.info(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};

/** Web Storage's own shape, read directly: the mount is the composition side of ADR-004. */
const promptTabsCapabilities: PromptTabsCapabilities = {
  storage: {
    get length() {
      return window.localStorage.length;
    },
    key: (index) => window.localStorage.key(index),
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
  },
  logger: promptBrowserLogger,
};

/** The API always mounts the execution door the Conversation tab posts to. */
const PLAYGROUND_CHAT_AVAILABILITY: PromptPlaygroundChatAvailability = { available: true };

class CapabilityPromptHost extends PromptHostApi {
  private readonly hostScope: PromptHostScope;
  private readonly session: UiSession;
  private readonly lent: UiCopyTargets;
  private readonly navigation: UiNavigation;
  private readonly uiRoute: UiRoute;
  private readonly feedback: UiFeedback;

  constructor({
    hostScope,
    session,
    lent,
    navigation,
    uiRoute,
    feedback,
  }: {
    hostScope: PromptHostScope;
    session: UiSession;
    lent: UiCopyTargets;
    navigation: UiNavigation;
    uiRoute: UiRoute;
    feedback: UiFeedback;
  }) {
    super();
    this.hostScope = hostScope;
    this.session = session;
    this.lent = lent;
    this.navigation = navigation;
    this.uiRoute = uiRoute;
    this.feedback = feedback;
  }

  scope(): PromptHostScope {
    return this.hostScope;
  }

  hasPermission(permission: string): boolean {
    return this.session.hasPermission(permission);
  }

  currentUserName(): string | null | undefined {
    return this.session.currentUser()?.name;
  }

  route(): PromptRouteReading {
    const { params, query } = this.uiRoute.reading();
    return { params, query };
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.uiRoute.setQuery(next, options);
  }

  navigate(to: string): void {
    this.navigation.navigate(to);
  }

  succeeded(notice: PromptSuccessNotice): void {
    this.feedback.succeeded(notice);
  }

  failed(failure: PromptFailureNotice): void {
    this.feedback.failed(failure);
  }

  /** Recorded gap: the dedup `WeakSet` lives on a MutationCache this build doesn't wrap. */
  isReportedGlobally(): boolean {
    return false;
  }

  /** Organization's lent targets; the label carries the team, as main's select did. */
  copyTargets(): readonly PromptCopyTarget[] {
    return (this.lent.targets("prompts:create") ?? []).map((target) => ({
      id: target.projectId,
      name: target.label,
      slug: target.projectSlug,
      canCreate: target.mayCreate,
    }));
  }

  playgroundChat(): PromptPlaygroundChatAvailability {
    return PLAYGROUND_CHAT_AVAILABILITY;
  }

  tabCapabilities(): PromptTabsCapabilities {
    return promptTabsCapabilities;
  }

  /** No upgrade modal above this screen; sends the reader to plan settings directly. */
  requestUpgrade(): void {
    this.navigation.navigate("/settings/subscription");
  }

  openPlatformDrawer(request: {
    drawer: PromptPlatformDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void {
    openDrawerAddress({ drawer: request.drawer, params: request.params, route: this.uiRoute });
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function PromptHostMount({ children }: { children?: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const lent = useUiCopyTargets();
  const { organizationId, projectId } = useUiScope().activeScope();
  const scopeHost: UiScopeHost | undefined = useUiScope().scopeHost();

  const hostScope = useMemo<PromptHostScope>(
    () => ({
      organizationId: organizationId ?? undefined,
      teamId: scopeHost?.team()?.id,
      projectId: projectId ?? undefined,
      projectSlug: scopeHost?.project()?.slug,
      projectApiKey: undefined,
    }),
    [organizationId, projectId, scopeHost],
  );

  const host = useMemo(
    () =>
      new CapabilityPromptHost({ hostScope, session, lent, navigation, uiRoute: route, feedback }),
    [hostScope, session, lent, navigation, route, feedback],
  );

  return <PromptHostProvider value={host}>{children}</PromptHostProvider>;
}
