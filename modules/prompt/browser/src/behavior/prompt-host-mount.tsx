/**
 * Prompt's answer to the port its screen declares: every method projects a
 * `@langwatch/browser-host` capability; organization lends `copyTargets`. §10.1.
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
import { readerUiStorage } from "@langwatch/browser-host/storage";
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
import { openDrawerAddress } from "./open-drawer-address.ts";

const promptBrowserLogger: PromptBrowserLogger = {
  info: (...args: unknown[]) => console.info(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};

/** The reader's own storage, so open tabs are theirs alone and sign-out forgets them. */
const promptTabsCapabilities: PromptTabsCapabilities = {
  storage: readerUiStorage,
  logger: promptBrowserLogger,
};

/** Tabs and their contents were once kept device-wide under these; nothing reads them now. */
const DEVICE_WIDE_TAB_KEY = /^[^:]+:(tab:.+|draggable-tabs-browser-store)$/;
let deviceWideTabsSwept = false;

function sweepDeviceWideTabs(): void {
  if (deviceWideTabsSwept) return;
  deviceWideTabsSwept = true;
  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, i) =>
      window.localStorage.key(i),
    );
    for (const key of keys) {
      if (key && DEVICE_WIDE_TAB_KEY.test(key)) window.localStorage.removeItem(key);
    }
  } catch {
    // A device that refuses storage kept nothing to sweep.
    return;
  }
}

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
    sweepDeviceWideTabs();
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
